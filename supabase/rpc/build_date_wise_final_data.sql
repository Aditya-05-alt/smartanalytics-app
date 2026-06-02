-- Admin pipeline Table 3 — daily SUM(views) from smart_final_data.
-- Run in Supabase SQL editor (same client_id / date filters as build_date_wise_ga4_data).

CREATE OR REPLACE FUNCTION public.build_date_wise_final_data(
  p_date_from date DEFAULT NULL,
  p_date_to   date DEFAULT NULL,
  p_client_id text DEFAULT NULL
)
RETURNS TABLE (
  report_date date,
  client_id   text,
  views       bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    f.report_date,
    f.client_id::text AS client_id,
    COALESCE(SUM(f.views), 0)::bigint AS views
  FROM public.smart_final_data f
  WHERE f.report_date >= COALESCE(p_date_from, f.report_date)
    AND f.report_date <= COALESCE(p_date_to, f.report_date)
    AND (
      p_client_id IS NULL
      OR f.client_id::text = trim(p_client_id)
    )
  GROUP BY f.report_date, f.client_id
  ORDER BY f.report_date;
$$;

GRANT EXECUTE ON FUNCTION public.build_date_wise_final_data(date, date, text)
  TO anon, authenticated, service_role;
