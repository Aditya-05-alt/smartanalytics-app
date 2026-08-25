-- Per-dealer GA4 property scope (e.g. Bama rv vs Bama RV sharing client_id 8881717635).
-- Also deploy updated RPCs in supabase/rpc/:
--   get_ga4_channel_breakdown.sql
--   get_wa_campaign_views_advance.sql
--   get_wa_campaign_cells_advance.sql

ALTER TABLE public.smart_hoot_config
  ADD COLUMN IF NOT EXISTS ga4_property_id text;

COMMENT ON COLUMN public.smart_hoot_config.ga4_property_id IS
  'When set, dashboard analytics filter smart_ga4_page_data to this property only.';

UPDATE public.smart_hoot_config
SET ga4_property_id = '317955532'
WHERE id = 109;

UPDATE public.smart_hoot_config
SET ga4_property_id = '502078026'
WHERE id = 69;

CREATE OR REPLACE FUNCTION public.ga4_property_scope_matches(
  p_row_property text,
  p_filter_property text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT
    COALESCE(NULLIF(btrim(p_filter_property), ''), '') = ''
    OR COALESCE(NULLIF(btrim(p_row_property), ''), '') = btrim(p_filter_property);
$$;

DROP FUNCTION IF EXISTS public.get_ga4_overview(text, date, date);

CREATE OR REPLACE FUNCTION public.get_ga4_overview(
  p_client_id text,
  p_from date,
  p_to date,
  p_ga4_property_id text DEFAULT NULL
)
RETURNS TABLE(
  report_date date,
  ga4_page_type text,
  views bigint,
  unique_pages bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    report_date,
    ga4_page_type,
    SUM(views)::bigint                AS views,
    COUNT(DISTINCT page_path)::bigint AS unique_pages
  FROM smart_ga4_page_data
  WHERE client_id = p_client_id
    AND report_date BETWEEN p_from AND p_to
    AND public.ga4_property_scope_matches(ga4_property_id, p_ga4_property_id)
  GROUP BY report_date, ga4_page_type
  ORDER BY report_date, ga4_page_type;
$$;

GRANT EXECUTE ON FUNCTION public.get_ga4_overview(text, date, date, text)
  TO anon, authenticated, service_role;
