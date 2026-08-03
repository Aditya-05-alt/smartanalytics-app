-- Per-dealer raw_data → inv_custom_type mapping (Hoot only).
-- Deploy in Supabase SQL editor BEFORE updating build_smart_final_data / get_type_breakdown.
--
-- Flow:
--   1. On Dealers admin, set inv_type_raw_key = the JSON key in smart_hoot_inventory.raw_data
--      that holds vehicle type for that dealer (e.g. "Custom label 1", "Vehicle Type", "Body Style").
--   2. Hoot Step 3 (build_smart_final_data) sets inv_custom_type = COALESCE(type_, raw_data->>key).
--      Scrap Step 3 does NOT set inv_custom_type.
--   3. Type Breakdown prefers inv_custom_type.
--
-- No DROP of table data. Only ADD COLUMN + optional cleanup of earlier list-based helpers.

-- ── 1. Columns ────────────────────────────────────────────────────────────────

ALTER TABLE public.smart_final_data
  ADD COLUMN IF NOT EXISTS inv_custom_type text;

COMMENT ON COLUMN public.smart_final_data.inv_custom_type IS
  'Resolved vehicle type: inventory type_ when present, else raw_data value for dealer inv_type_raw_key.';

CREATE INDEX IF NOT EXISTS idx_smart_final_data_inv_custom_type
  ON public.smart_final_data (client_id, report_date, inv_custom_type)
  WHERE inv_custom_type IS NOT NULL AND TRIM(inv_custom_type) <> '';

-- Speed up type refresh joins (client + day range, blank custom type).
CREATE INDEX IF NOT EXISTS idx_smart_final_data_client_date_type_fill
  ON public.smart_final_data (client_id, report_date)
  INCLUDE (inv_url, inv_type, inv_custom_type);

CREATE INDEX IF NOT EXISTS idx_smart_hoot_inventory_customer_url
  ON public.smart_hoot_inventory (customer_name, url)
  WHERE url IS NOT NULL AND TRIM(url) <> '';

ALTER TABLE public.smart_hoot_config
  ADD COLUMN IF NOT EXISTS inv_type_raw_key text;

COMMENT ON COLUMN public.smart_hoot_config.inv_type_raw_key IS
  'JSON key inside smart_hoot_inventory.raw_data used when type_/inv_type is blank (Hoot only). '
  'Example: Custom label 1, Vehicle Type, Body Style. Exact key name as stored in raw_data.';

-- ── 2. Drop earlier list-based approach (functions/table only — no row data loss) ─

DROP FUNCTION IF EXISTS public.resolve_inv_custom_type(
  text, text, text, text, text, text, text, text, text, text
);
DROP FUNCTION IF EXISTS public.resolve_inv_custom_type(text);
DROP FUNCTION IF EXISTS public.backfill_inv_custom_type(text, date, date);
DROP TABLE IF EXISTS public.smart_inv_custom_type_list;

-- ── 3. Backfill from inventory.raw_data using dealer key (fast join, 1-day chunks) ─

CREATE OR REPLACE FUNCTION public.backfill_inv_custom_type(
  p_client_id text,
  p_date_from date,
  p_date_to   date
)
RETURNS TABLE (
  updated_rows  bigint,
  links_updated bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '55s'
AS $$
DECLARE
  v_updated     bigint := 0;
  v_links       bigint := 0;
  v_customer    text;
  v_raw_key     text;
BEGIN
  IF p_client_id IS NULL OR TRIM(p_client_id) = '' THEN
    RAISE EXCEPTION 'p_client_id is required';
  END IF;
  IF p_date_from IS NULL OR p_date_to IS NULL THEN
    RAISE EXCEPTION 'p_date_from and p_date_to are required';
  END IF;
  IF p_date_from > p_date_to THEN
    RAISE EXCEPTION 'Invalid date range: % .. %', p_date_from, p_date_to;
  END IF;
  -- UI calls this 1 day at a time; allow up to 3 days as a hard cap.
  IF (p_date_to - p_date_from) > 2 THEN
    RAISE EXCEPTION 'Date range too large (% days). Call with 1 day (or max 3) per request.',
      (p_date_to - p_date_from + 1);
  END IF;

  SELECT
    h.customer_name,
    NULLIF(TRIM(h.inv_type_raw_key), '')
  INTO v_customer, v_raw_key
  FROM public.smart_hoot_config h
  WHERE trim(h.ga4_customer_id::text) = trim(p_client_id)
  ORDER BY h.id DESC
  LIMIT 1;

  IF v_customer IS NULL THEN
    RAISE EXCEPTION 'No smart_hoot_config row for client_id %', p_client_id;
  END IF;
  IF v_raw_key IS NULL THEN
    RAISE EXCEPTION 'inv_type_raw_key is not set for this dealer';
  END IF;

  -- Build URL → type map once for this dealer (no per-row inventory subquery).
  -- Always re-resolve from current inv_type_raw_key so a wrong-key refresh can be overwritten.
  WITH inv_map AS (
    SELECT DISTINCT ON (lower(btrim(i.url)))
      lower(btrim(i.url)) AS url_lower,
      COALESCE(
        NULLIF(TRIM(i.type_), ''),
        NULLIF(TRIM(i.raw_data ->> v_raw_key), '')
      ) AS resolved_type
    FROM public.smart_hoot_inventory i
    WHERE i.customer_name = v_customer
      AND i.url IS NOT NULL
      AND btrim(i.url) <> ''
    ORDER BY lower(btrim(i.url)), i.last_seen DESC NULLS LAST
  ),
  matched AS (
    SELECT
      s.ctid AS row_ctid,
      s.inv_url,
      COALESCE(
        NULLIF(TRIM(s.inv_type), ''),
        m.resolved_type
      ) AS new_type
    FROM public.smart_final_data s
    LEFT JOIN inv_map m
      ON s.inv_url IS NOT NULL
     AND btrim(s.inv_url) <> ''
     AND m.url_lower = lower(btrim(s.inv_url))
    WHERE s.client_id::text = trim(p_client_id)
      AND s.report_date BETWEEN p_date_from AND p_date_to
  ),
  upd AS (
    UPDATE public.smart_final_data AS s
    SET inv_custom_type = t.new_type
    FROM matched t
    WHERE s.ctid = t.row_ctid
      AND NULLIF(TRIM(s.inv_custom_type), '') IS DISTINCT FROM NULLIF(TRIM(t.new_type), '')
    RETURNING NULLIF(TRIM(s.inv_url), '') AS inv_url
  )
  SELECT
    COUNT(*)::bigint,
    COUNT(DISTINCT inv_url)::bigint
  INTO v_updated, v_links
  FROM upd;

  RETURN QUERY SELECT COALESCE(v_updated, 0), COALESCE(v_links, 0);
END;
$$;

COMMENT ON FUNCTION public.backfill_inv_custom_type(text, date, date) IS
  'Re-map inv_custom_type for one dealer + short date range (prefer 1 day). '
  'Overwrites previous values from the current inv_type_raw_key (clears when unresolved).';

GRANT EXECUTE ON FUNCTION public.backfill_inv_custom_type(text, date, date)
  TO service_role;

-- After deploy: set the CORRECT key in Admin → Dealers, pick date range, Refresh types.
-- Re-running with a fixed key overrides a mistaken earlier refresh.
-- Manual:
--   SELECT * FROM public.backfill_inv_custom_type('YOUR_GA4_CLIENT_ID', '2026-07-02', '2026-07-02');
