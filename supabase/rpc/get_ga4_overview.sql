-- All-tab overview: page-grain views by date + ga4_page_type.
-- SECURITY DEFINER so reads work after RLS is enabled on smart_ga4_page_data.
-- Deploy before enabling RLS, or run supabase/migrations/20260824_rls_ready_smart_ga4_page_data.sql.

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
