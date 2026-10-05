-- Daily VDP views for dealers that share a GA4 client_id and are scoped by ga4_property_id.
-- Aggregates in SQL so the KPI/chart get ~30 rows instead of paging every raw page row.

CREATE OR REPLACE FUNCTION public.get_vdp_views_by_date_scoped(
  p_client_id text,
  p_ga4_property_id text,
  p_from date,
  p_to date
)
RETURNS TABLE (report_date date, views bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.report_date, sum(p.views)::bigint AS views
  FROM smart_ga4_page_data p
  WHERE p.client_id = btrim(p_client_id)
    AND p.ga4_property_id = btrim(p_ga4_property_id)
    AND p.vdp_conditions IS TRUE
    AND p.report_date BETWEEN p_from AND p_to
  GROUP BY p.report_date
  ORDER BY p.report_date;
$$;

REVOKE ALL ON FUNCTION public.get_vdp_views_by_date_scoped(text, text, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_vdp_views_by_date_scoped(text, text, date, date) TO authenticated, service_role;
