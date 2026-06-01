-- Run in Supabase SQL editor. Fixes slow / timeout queries on large page tables.
--
-- 1) Index (run once; CONCURRENTLY avoids long locks):
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ga4_page_data_date_client
--   ON public.smart_ga4_page_data (report_date, client_id);

CREATE OR REPLACE FUNCTION public.build_date_wise_ga4_data(
  p_date_from date DEFAULT NULL,
  p_date_to   date DEFAULT NULL,
  p_client_id text DEFAULT NULL
)
RETURNS TABLE (
  report_date    date,
  client_id      text,
  account_name   text,
  customer_name  text,
  views          bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH daily AS (
    SELECT
      p.report_date,
      p.client_id::text AS client_id,
      MAX(p.account_name) AS account_name,
      COALESCE(SUM(p.views), 0)::bigint AS views
    FROM public.smart_ga4_page_data p
    WHERE p.report_date >= COALESCE(p_date_from, p.report_date)
      AND p.report_date <= COALESCE(p_date_to, p.report_date)
      AND (
        p_client_id IS NULL
        OR p.client_id::text = trim(p_client_id)
      )
    GROUP BY p.report_date, p.client_id
  ),
  hoot AS (
    SELECT DISTINCT ON (ga4_customer_id::text)
      ga4_customer_id::text AS ga4_id,
      customer_name
    FROM public.smart_hoot_config
    WHERE ga4_customer_id IS NOT NULL
    ORDER BY ga4_customer_id::text, id DESC
  )
  SELECT
    d.report_date,
    d.client_id,
    d.account_name,
    h.customer_name,
    d.views
  FROM daily d
  LEFT JOIN hoot h ON h.ga4_id = d.client_id
  ORDER BY d.report_date, d.account_name;
$$;

GRANT EXECUTE ON FUNCTION public.build_date_wise_ga4_data(date, date, text)
  TO anon, authenticated, service_role;
