CREATE OR REPLACE FUNCTION public.get_event_tracking_page_users(
  p_client_id text,
  p_from date,
  p_to date
)
RETURNS TABLE (
  report_date date,
  total_users bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '55s'
AS $$
  SELECT
    p.report_date,
    COALESCE(SUM(p.total_users), 0)::bigint AS total_users
  FROM public.smart_ga4_page_data p
  WHERE p.client_id::text = btrim(p_client_id)
    AND p.report_date BETWEEN p_from AND p_to
  GROUP BY p.report_date
  ORDER BY p.report_date;
$$;

REVOKE ALL ON FUNCTION public.get_event_tracking_page_users(text, date, date)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_event_tracking_page_users(text, date, date)
  TO service_role;
