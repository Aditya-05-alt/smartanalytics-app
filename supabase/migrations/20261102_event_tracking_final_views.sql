CREATE OR REPLACE FUNCTION public.get_event_tracking_final_views(
  p_client_id text,
  p_from date,
  p_to date
)
RETURNS TABLE (
  report_date date,
  views bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '55s'
AS $$
  SELECT
    f.report_date,
    COALESCE(SUM(f.views), 0)::bigint AS views
  FROM public.smart_final_data f
  WHERE f.client_id::text = btrim(p_client_id)
    AND f.report_date BETWEEN p_from AND p_to
  GROUP BY f.report_date
  ORDER BY f.report_date;
$$;

REVOKE ALL ON FUNCTION public.get_event_tracking_final_views(text, date, date)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_event_tracking_final_views(text, date, date)
  TO service_role;
