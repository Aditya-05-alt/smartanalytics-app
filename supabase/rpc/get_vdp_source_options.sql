-- Distinct GA4 sources for VDP filter dropdown (normalized keys, ordered by views desc).

DROP FUNCTION IF EXISTS public.get_vdp_source_options(text, date, date);
DROP FUNCTION IF EXISTS public.get_vdp_source_options(text, date, date, text);

CREATE OR REPLACE FUNCTION public.get_vdp_source_options(
  p_client_id text,
  p_from date,
  p_to date,
  p_ga4_property_id text DEFAULT NULL
)
RETURNS TABLE (
  source text,
  views bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '30s'
AS $$
  SELECT
    public.vdp_source_key(p.source) AS source,
    SUM(COALESCE(p.views, 0))::bigint AS views
  FROM public.smart_ga4_page_data p
  WHERE p.client_id::text = trim(p_client_id)
    AND p.report_date BETWEEN p_from AND p_to
    AND public.ga4_property_scope_matches(p.ga4_property_id, p_ga4_property_id)
    AND p.vdp_conditions IS TRUE
  GROUP BY 1
  HAVING SUM(COALESCE(p.views, 0)) > 0
  ORDER BY views DESC, source;
$$;

REVOKE ALL ON FUNCTION public.get_vdp_source_options(text, date, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_vdp_source_options(text, date, date, text)
  TO anon, authenticated, service_role;