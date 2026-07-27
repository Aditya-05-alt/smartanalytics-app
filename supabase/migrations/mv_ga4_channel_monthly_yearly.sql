-- Monthly + yearly channel MVs for All Dealers (fast year / multi-month compare).
-- Built from full smart_ga4_page_data (includes previous years).
-- Deploy in Supabase SQL editor BEFORE updating get_all_dealers_channel_matrix.
-- Then refresh after GA4 sync / filtration.

-- ── Monthly grain ──────────────────────────────────────────────────────────
DROP MATERIALIZED VIEW IF EXISTS public.mv_ga4_channel_monthly CASCADE;

CREATE MATERIALIZED VIEW public.mv_ga4_channel_monthly AS
SELECT
  client_id,
  (date_trunc('month', report_date))::date AS month_start,
  channel,
  ga4_page_type,
  SUM(COALESCE(views, 0))::bigint AS views
FROM public.smart_ga4_page_data
GROUP BY client_id, (date_trunc('month', report_date))::date, channel, ga4_page_type;

CREATE UNIQUE INDEX mv_ga4_channel_monthly_uid
  ON public.mv_ga4_channel_monthly (client_id, month_start, channel, ga4_page_type);

CREATE INDEX mv_ga4_channel_monthly_month_client
  ON public.mv_ga4_channel_monthly (month_start, client_id);

-- ── Yearly grain ───────────────────────────────────────────────────────────
DROP MATERIALIZED VIEW IF EXISTS public.mv_ga4_channel_yearly CASCADE;

CREATE MATERIALIZED VIEW public.mv_ga4_channel_yearly AS
SELECT
  client_id,
  EXTRACT(YEAR FROM report_date)::int AS report_year,
  channel,
  ga4_page_type,
  SUM(COALESCE(views, 0))::bigint AS views
FROM public.smart_ga4_page_data
GROUP BY client_id, EXTRACT(YEAR FROM report_date)::int, channel, ga4_page_type;

CREATE UNIQUE INDEX mv_ga4_channel_yearly_uid
  ON public.mv_ga4_channel_yearly (client_id, report_year, channel, ga4_page_type);

CREATE INDEX mv_ga4_channel_yearly_year_client
  ON public.mv_ga4_channel_yearly (report_year, client_id);

COMMENT ON MATERIALIZED VIEW public.mv_ga4_channel_monthly IS
  'All Dealers: monthly channel views from smart_ga4_page_data (year/month compare).';
COMMENT ON MATERIALIZED VIEW public.mv_ga4_channel_yearly IS
  'All Dealers: yearly channel views from smart_ga4_page_data (full-year / YTD compare).';

-- First load is already populated by CREATE. Later:
--   REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_ga4_channel_monthly;
--   REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_ga4_channel_yearly;
