-- VDP channel MVs + covering index for All Dealers / Compare (KPI-aligned).
-- Source: smart_ga4_page_data WHERE vdp_conditions IS TRUE
-- (same definition as Overview VDP Views KPI)

CREATE INDEX IF NOT EXISTS idx_ga4_vdp_client_date_channel
  ON public.smart_ga4_page_data (client_id, report_date, channel)
  INCLUDE (views)
  WHERE vdp_conditions IS TRUE;

DROP MATERIALIZED VIEW IF EXISTS public.mv_ga4_vdp_channel_daily CASCADE;
CREATE MATERIALIZED VIEW public.mv_ga4_vdp_channel_daily AS
SELECT
  client_id,
  report_date,
  channel,
  SUM(COALESCE(views, 0))::bigint AS views
FROM public.smart_ga4_page_data
WHERE vdp_conditions IS TRUE
GROUP BY client_id, report_date, channel;

CREATE UNIQUE INDEX mv_ga4_vdp_channel_daily_uid
  ON public.mv_ga4_vdp_channel_daily (client_id, report_date, channel);
CREATE INDEX mv_ga4_vdp_channel_daily_date_client
  ON public.mv_ga4_vdp_channel_daily (report_date, client_id);

DROP MATERIALIZED VIEW IF EXISTS public.mv_ga4_vdp_channel_monthly CASCADE;
CREATE MATERIALIZED VIEW public.mv_ga4_vdp_channel_monthly AS
SELECT
  client_id,
  (date_trunc('month', report_date))::date AS month_start,
  channel,
  SUM(COALESCE(views, 0))::bigint AS views
FROM public.smart_ga4_page_data
WHERE vdp_conditions IS TRUE
GROUP BY client_id, (date_trunc('month', report_date))::date, channel;

CREATE UNIQUE INDEX mv_ga4_vdp_channel_monthly_uid
  ON public.mv_ga4_vdp_channel_monthly (client_id, month_start, channel);
CREATE INDEX mv_ga4_vdp_channel_monthly_month_client
  ON public.mv_ga4_vdp_channel_monthly (month_start, client_id);

DROP MATERIALIZED VIEW IF EXISTS public.mv_ga4_vdp_channel_yearly CASCADE;
CREATE MATERIALIZED VIEW public.mv_ga4_vdp_channel_yearly AS
SELECT
  client_id,
  EXTRACT(YEAR FROM report_date)::int AS report_year,
  channel,
  SUM(COALESCE(views, 0))::bigint AS views
FROM public.smart_ga4_page_data
WHERE vdp_conditions IS TRUE
GROUP BY client_id, EXTRACT(YEAR FROM report_date)::int, channel;

CREATE UNIQUE INDEX mv_ga4_vdp_channel_yearly_uid
  ON public.mv_ga4_vdp_channel_yearly (client_id, report_year, channel);
CREATE INDEX mv_ga4_vdp_channel_yearly_year_client
  ON public.mv_ga4_vdp_channel_yearly (report_year, client_id);

COMMENT ON MATERIALIZED VIEW public.mv_ga4_vdp_channel_daily IS
  'All Dealers VDP: daily channel views where vdp_conditions IS TRUE.';
COMMENT ON MATERIALIZED VIEW public.mv_ga4_vdp_channel_monthly IS
  'All Dealers VDP: monthly channel views where vdp_conditions IS TRUE.';
COMMENT ON MATERIALIZED VIEW public.mv_ga4_vdp_channel_yearly IS
  'All Dealers VDP: yearly channel views where vdp_conditions IS TRUE.';
