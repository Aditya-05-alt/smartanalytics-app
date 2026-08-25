-- Per-property VDP logic (e.g. Bama RV vs Bama rv sharing client_id 8881717635).

ALTER TABLE public.smart_vdp_logic
  ADD COLUMN IF NOT EXISTS ga4_property_id text;

COMMENT ON COLUMN public.smart_vdp_logic.ga4_property_id IS
  'When set, Step 2 applies this row only to smart_ga4_page_data with matching ga4_property_id. NULL = legacy (all properties for dealer_id).';

-- Bama: split old vs new property rows.
UPDATE public.smart_vdp_logic
SET
  dealer_name = 'Bama RV',
  ga4_property_id = '502078026',
  updated_at = NOW()
WHERE id = 25;

INSERT INTO public.smart_vdp_logic (
  dealer_name,
  dealer_id,
  ga4_property_id,
  website_url,
  cms,
  data_source,
  hoot_link,
  scrap_link,
  vdp_logic,
  srp_logic,
  home_page_logic,
  others,
  created_at,
  updated_at
)
SELECT
  'Bama rv',
  dealer_id,
  '317955532',
  website_url,
  cms,
  data_source,
  hoot_link,
  scrap_link,
  vdp_logic,
  srp_logic,
  home_page_logic,
  others,
  NOW(),
  NOW()
FROM public.smart_vdp_logic
WHERE id = 25
  AND NOT EXISTS (
    SELECT 1
    FROM public.smart_vdp_logic v
    WHERE v.dealer_id = '8881717635'
      AND v.ga4_property_id = '317955532'
  );

CREATE UNIQUE INDEX IF NOT EXISTS smart_vdp_logic_dealer_property_uidx
  ON public.smart_vdp_logic (dealer_id, ga4_property_id)
  WHERE ga4_property_id IS NOT NULL AND btrim(ga4_property_id) <> '';

-- Step 2 (admin date range) — match VDP logic row by client_id + optional property.
DROP FUNCTION IF EXISTS public.apply_vdp_filtration_range(text, date, date);

CREATE OR REPLACE FUNCTION public.apply_vdp_filtration_range(
  p_client_id text DEFAULT NULL,
  p_from      date  DEFAULT NULL,
  p_to        date  DEFAULT NULL
)
RETURNS TABLE(out_account_name text, out_cms text, out_updated_rows bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_from IS NULL OR p_to IS NULL THEN
    RAISE EXCEPTION 'p_from and p_to are required';
  END IF;

  UPDATE smart_ga4_page_data g
  SET cms = h.website_platform
  FROM smart_hoot_config h
  WHERE g.report_date BETWEEN p_from AND p_to
    AND (g.cms IS NULL OR g.cms = '')
    AND g.client_id = h.ga4_customer_id::text
    AND public.ga4_property_scope_matches(g.ga4_property_id, h.ga4_property_id)
    AND (p_client_id IS NULL OR g.client_id = p_client_id);

  RETURN QUERY
  WITH updated_data AS (
    UPDATE smart_ga4_page_data g
    SET
      vdp_conditions = public.page_path_matches_vdp_logic(g.page_path, sl.vdp_logic),

      ga4_page_type = CASE
        WHEN public.page_path_matches_vdp_logic(g.page_path, sl.vdp_logic) THEN 'VDP'
        WHEN sl.home_page_logic IS NOT NULL AND sl.home_page_logic <> ''
             AND LOWER(sl.home_page_logic) NOT IN ('true','false')
             AND g.page_path ~* sl.home_page_logic THEN 'Home page'
        WHEN sl.srp_logic IS NOT NULL AND sl.srp_logic <> ''
             AND LOWER(sl.srp_logic) NOT IN ('true','false')
             AND g.page_path ~* sl.srp_logic THEN 'SRP'
        ELSE 'Other Page'
      END,

      vdp_vehicle_condition = CASE
        WHEN public.page_path_matches_vdp_logic(g.page_path, sl.vdp_logic) THEN
          CASE
            WHEN g.page_path ILIKE '%new%'  THEN 'New'
            WHEN g.page_path ILIKE '%used%' THEN 'Used'
            ELSE NULL
          END
        ELSE NULL
      END,

      year = CASE
        WHEN public.page_path_matches_vdp_logic(g.page_path, sl.vdp_logic)
             AND g.page_path ~* '\d{4}'
        THEN SUBSTRING(g.page_path FROM '(\d{4})')::INTEGER
        ELSE NULL
      END

    FROM smart_vdp_logic sl
    WHERE g.report_date BETWEEN p_from AND p_to
      AND g.client_id = sl.dealer_id
      AND public.ga4_property_scope_matches(g.ga4_property_id, sl.ga4_property_id)
      AND sl.vdp_logic IS NOT NULL
      AND sl.vdp_logic <> ''
      AND EXISTS (
        SELECT 1
        FROM unnest(
          regexp_split_to_array(sl.vdp_logic, E'\\s+OR\\s+', 'i')
        ) AS pat
        WHERE btrim(pat) <> ''
          AND lower(btrim(pat)) NOT IN ('true', 'false')
          AND length(btrim(pat)) >= 5
      )
      AND (p_client_id IS NULL OR g.client_id = p_client_id)
    RETURNING g.account_name, g.cms
  )
  SELECT updated_data.account_name, updated_data.cms, COUNT(*)::bigint
  FROM updated_data
  GROUP BY updated_data.account_name, updated_data.cms;
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_vdp_filtration_range(text, date, date)
  TO service_role;

-- Cron Step 2 — same property scope on VDP logic join.
DROP FUNCTION IF EXISTS public.apply_vdp_filtration(text, integer);

CREATE OR REPLACE FUNCTION public.apply_vdp_filtration(
  p_client_id text DEFAULT NULL,
  p_days_back integer DEFAULT NULL
)
RETURNS TABLE(out_account_name text, out_cms text, out_updated_rows bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE smart_ga4_page_data g
  SET cms = h.website_platform
  FROM smart_hoot_config h
  WHERE g.report_date >= (CURRENT_DATE - p_days_back)
    AND (g.cms IS NULL OR g.cms = '')
    AND g.client_id = h.ga4_customer_id::text
    AND public.ga4_property_scope_matches(g.ga4_property_id, h.ga4_property_id)
    AND (p_client_id IS NULL OR g.client_id = p_client_id);

  RETURN QUERY
  WITH updated_data AS (
    UPDATE smart_ga4_page_data g
    SET
      vdp_conditions = public.page_path_matches_vdp_logic(g.page_path, sl.vdp_logic),

      ga4_page_type = CASE
        WHEN public.page_path_matches_vdp_logic(g.page_path, sl.vdp_logic) THEN 'VDP'
        WHEN sl.home_page_logic IS NOT NULL AND sl.home_page_logic <> ''
             AND LOWER(sl.home_page_logic) NOT IN ('true','false')
             AND g.page_path ~* sl.home_page_logic THEN 'Home page'
        WHEN sl.srp_logic IS NOT NULL AND sl.srp_logic <> ''
             AND LOWER(sl.srp_logic) NOT IN ('true','false')
             AND g.page_path ~* sl.srp_logic THEN 'SRP'
        ELSE 'Other Page'
      END,

      vdp_vehicle_condition = CASE
        WHEN public.page_path_matches_vdp_logic(g.page_path, sl.vdp_logic) THEN
          CASE
            WHEN g.page_path ILIKE '%new%'  THEN 'New'
            WHEN g.page_path ILIKE '%used%' THEN 'Used'
            ELSE NULL
          END
        ELSE NULL
      END,

      year = CASE
        WHEN public.page_path_matches_vdp_logic(g.page_path, sl.vdp_logic)
             AND g.page_path ~* '\d{4}'
        THEN SUBSTRING(g.page_path FROM '(\d{4})')::INTEGER
        ELSE NULL
      END

    FROM smart_vdp_logic sl
    WHERE g.report_date >= (CURRENT_DATE - p_days_back)
      AND g.client_id = sl.dealer_id
      AND public.ga4_property_scope_matches(g.ga4_property_id, sl.ga4_property_id)
      AND sl.vdp_logic IS NOT NULL
      AND sl.vdp_logic <> ''
      AND EXISTS (
        SELECT 1
        FROM unnest(
          regexp_split_to_array(sl.vdp_logic, E'\\s+OR\\s+', 'i')
        ) AS pat
        WHERE btrim(pat) <> ''
          AND lower(btrim(pat)) NOT IN ('true', 'false')
          AND length(btrim(pat)) >= 5
      )
      AND (p_client_id IS NULL OR g.client_id = p_client_id)
    RETURNING g.account_name, g.cms
  )
  SELECT updated_data.account_name, updated_data.cms, COUNT(*)::bigint
  FROM updated_data
  GROUP BY updated_data.account_name, updated_data.cms;
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_vdp_filtration(text, integer)
  TO service_role;

-- Admin VDP Logics list RPC.
DROP FUNCTION IF EXISTS public.build_vdp_logics(text, text, text, text);

CREATE OR REPLACE FUNCTION public.build_vdp_logics(
  p_dealer_name   text DEFAULT NULL,
  p_cms           text DEFAULT NULL,
  p_data_source   text DEFAULT NULL,
  p_search        text DEFAULT NULL
)
RETURNS TABLE (
  id                 integer,
  dealer_name        text,
  dealer_id          text,
  ga4_property_id    text,
  website_url        text,
  cms                text,
  data_source        text,
  hoot_link          text,
  scrap_link         text,
  vdp_logic          text,
  srp_logic          text,
  home_page_logic    text,
  others             text,
  created_at         timestamptz,
  updated_at         timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    v.id,
    v.dealer_name,
    v.dealer_id,
    v.ga4_property_id,
    v.website_url,
    v.cms,
    v.data_source,
    v.hoot_link,
    v.scrap_link,
    v.vdp_logic,
    v.srp_logic,
    v.home_page_logic,
    v.others,
    v.created_at,
    v.updated_at
  FROM public.smart_vdp_logic v
  WHERE (p_dealer_name IS NULL OR trim(p_dealer_name) = '' OR v.dealer_name ILIKE '%' || trim(p_dealer_name) || '%')
    AND (p_cms IS NULL OR trim(p_cms) = '' OR v.cms = trim(p_cms))
    AND (p_data_source IS NULL OR trim(p_data_source) = '' OR v.data_source = trim(p_data_source))
    AND (
      p_search IS NULL
      OR trim(p_search) = ''
      OR v.dealer_name ILIKE '%' || trim(p_search) || '%'
      OR v.dealer_id ILIKE '%' || trim(p_search) || '%'
      OR v.ga4_property_id ILIKE '%' || trim(p_search) || '%'
      OR v.website_url ILIKE '%' || trim(p_search) || '%'
      OR v.cms ILIKE '%' || trim(p_search) || '%'
      OR v.data_source ILIKE '%' || trim(p_search) || '%'
      OR v.vdp_logic ILIKE '%' || trim(p_search) || '%'
      OR v.srp_logic ILIKE '%' || trim(p_search) || '%'
      OR v.home_page_logic ILIKE '%' || trim(p_search) || '%'
      OR v.others ILIKE '%' || trim(p_search) || '%'
    )
  ORDER BY v.dealer_name ASC NULLS LAST, v.id ASC;
$$;

GRANT EXECUTE ON FUNCTION public.build_vdp_logics(text, text, text, text)
  TO anon, authenticated, service_role;
