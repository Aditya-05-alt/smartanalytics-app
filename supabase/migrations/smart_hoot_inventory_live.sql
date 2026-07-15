-- smart_hoot_inventory_live — daily full-replace Hoot CSV feed (no first_seen / last_seen).
-- Populated by edge function hoot-inventory-live-sync (truncate + insert each run).
-- Daily snapshot reads this table → smart_hoot_inventory_daily.
--
-- Deploy in Supabase SQL Editor (full file).

-- ── Table ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.smart_hoot_inventory_live (
  sk                 text NOT NULL,
  vin                text NULL,
  url                text NULL,
  advertiser         text NULL,
  make               text NULL,
  model              text NULL,
  year               text NULL,
  price              numeric NULL,
  condition          text NULL,
  raw_data           jsonb NULL,
  customer_name      text NULL,
  ga4_customer_id    text NULL,
  location           text NULL,
  msrp               numeric NULL,
  type_              text NULL,
  trim               text NULL,
  stock_number       text NULL,
  website_platform   text NULL,
  synced_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT smart_hoot_inventory_live_pkey PRIMARY KEY (sk)
);

COMMENT ON TABLE public.smart_hoot_inventory_live IS
  'Live Hoot inventory from dealer hoot_url CSV feeds. Full replace on each sync (no historical rows).';

CREATE INDEX IF NOT EXISTS idx_hoot_inv_live_customer_name
  ON public.smart_hoot_inventory_live (customer_name);

CREATE INDEX IF NOT EXISTS idx_hoot_inv_live_ga4_customer_id
  ON public.smart_hoot_inventory_live (ga4_customer_id);

CREATE INDEX IF NOT EXISTS idx_hoot_inv_live_synced_at
  ON public.smart_hoot_inventory_live (synced_at DESC);

-- ── Sync log ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.smart_hoot_inventory_live_log (
  id              bigserial PRIMARY KEY,
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz NULL,
  dealers_total   integer NULL,
  dealers_ok      integer NULL,
  row_count       bigint NULL,
  note            text NULL
);

-- ── RPC: truncate live table (start of sync) ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.truncate_smart_hoot_inventory_live()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  TRUNCATE TABLE public.smart_hoot_inventory_live;
END;
$$;

COMMENT ON FUNCTION public.truncate_smart_hoot_inventory_live() IS
  'Delete all rows from smart_hoot_inventory_live before a full re-sync.';

-- ── RPC: batch insert from edge function ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.insert_smart_hoot_inventory_live_batch(
  p_rows jsonb
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count bigint;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RETURN 0;
  END IF;

  INSERT INTO public.smart_hoot_inventory_live (
    sk,
    vin,
    url,
    advertiser,
    make,
    model,
    year,
    price,
    condition,
    raw_data,
    customer_name,
    ga4_customer_id,
    location,
    msrp,
    type_,
    trim,
    stock_number,
    website_platform,
    synced_at
  )
  SELECT
    NULLIF(TRIM(r->>'sk'), ''),
    NULLIF(TRIM(r->>'vin'), ''),
    NULLIF(TRIM(r->>'url'), ''),
    NULLIF(TRIM(r->>'advertiser'), ''),
    NULLIF(TRIM(r->>'make'), ''),
    NULLIF(TRIM(r->>'model'), ''),
    NULLIF(TRIM(r->>'year'), ''),
    NULLIF((r->>'price')::text, '')::numeric,
    NULLIF(TRIM(r->>'condition'), ''),
    CASE WHEN r ? 'raw_data' THEN r->'raw_data' ELSE NULL END,
    NULLIF(TRIM(r->>'customer_name'), ''),
    NULLIF(TRIM(r->>'ga4_customer_id'), ''),
    NULLIF(TRIM(r->>'location'), ''),
    NULLIF((r->>'msrp')::text, '')::numeric,
    NULLIF(TRIM(r->>'type_'), ''),
    NULLIF(TRIM(r->>'trim'), ''),
    NULLIF(TRIM(r->>'stock_number'), ''),
    NULLIF(TRIM(r->>'website_platform'), ''),
    COALESCE((r->>'synced_at')::timestamptz, now())
  FROM jsonb_array_elements(p_rows) AS r
  WHERE NULLIF(TRIM(r->>'sk'), '') IS NOT NULL
  ON CONFLICT ON CONSTRAINT smart_hoot_inventory_live_pkey DO UPDATE SET
    vin              = EXCLUDED.vin,
    url              = EXCLUDED.url,
    advertiser       = EXCLUDED.advertiser,
    make             = EXCLUDED.make,
    model            = EXCLUDED.model,
    year             = EXCLUDED.year,
    price            = EXCLUDED.price,
    condition        = EXCLUDED.condition,
    raw_data         = EXCLUDED.raw_data,
    customer_name    = EXCLUDED.customer_name,
    ga4_customer_id  = EXCLUDED.ga4_customer_id,
    location         = EXCLUDED.location,
    msrp             = EXCLUDED.msrp,
    type_            = EXCLUDED.type_,
    trim             = EXCLUDED.trim,
    stock_number     = EXCLUDED.stock_number,
    website_platform = EXCLUDED.website_platform,
    synced_at        = EXCLUDED.synced_at;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.insert_smart_hoot_inventory_live_batch(jsonb) IS
  'Insert/upsert a batch of rows into smart_hoot_inventory_live from edge sync JSON array.';

-- ── RPC: finish log entry ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.finish_smart_hoot_inventory_live_log(
  p_log_id        bigint,
  p_dealers_total integer,
  p_dealers_ok    integer,
  p_row_count     bigint,
  p_note          text DEFAULT 'ok'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.smart_hoot_inventory_live_log
  SET finished_at = now(),
      dealers_total = p_dealers_total,
      dealers_ok = p_dealers_ok,
      row_count = p_row_count,
      note = p_note
  WHERE id = p_log_id;
END;
$$;

GRANT SELECT ON public.smart_hoot_inventory_live TO anon, authenticated, service_role;
GRANT SELECT ON public.smart_hoot_inventory_live_log TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.truncate_smart_hoot_inventory_live() TO service_role;
GRANT EXECUTE ON FUNCTION public.insert_smart_hoot_inventory_live_batch(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_smart_hoot_inventory_live_log(bigint, integer, integer, bigint, text) TO service_role;

-- Verification:
--   SELECT COUNT(*) FROM public.smart_hoot_inventory_live;
