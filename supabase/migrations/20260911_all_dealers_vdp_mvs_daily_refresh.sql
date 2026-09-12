-- All Dealers VDP: create KPI-aligned MVs + daily refresh + wire RPC.
-- Does not change Compare or Overview RPCs.

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

GRANT SELECT ON public.mv_ga4_vdp_channel_daily TO anon, authenticated, service_role;
GRANT SELECT ON public.mv_ga4_vdp_channel_monthly TO anon, authenticated, service_role;
GRANT SELECT ON public.mv_ga4_vdp_channel_yearly TO anon, authenticated, service_role;

COMMENT ON MATERIALIZED VIEW public.mv_ga4_vdp_channel_daily IS
  'All Dealers VDP: daily channel views where vdp_conditions IS TRUE.';
COMMENT ON MATERIALIZED VIEW public.mv_ga4_vdp_channel_monthly IS
  'All Dealers VDP: monthly channel views where vdp_conditions IS TRUE.';
COMMENT ON MATERIALIZED VIEW public.mv_ga4_vdp_channel_yearly IS
  'All Dealers VDP: yearly channel views where vdp_conditions IS TRUE.';

-- Daily refresh (8:30–9:30 AM IST window = 03:00–03:25 UTC)
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT jobname
    FROM cron.job
    WHERE jobname IN (
      'refresh-mv-ga4-vdp-channel-daily',
      'refresh-mv-ga4-vdp-channel-monthly',
      'refresh-mv-ga4-vdp-channel-yearly'
    )
  LOOP
    PERFORM cron.unschedule(r.jobname);
  END LOOP;
END $$;

SELECT cron.schedule(
  'refresh-mv-ga4-vdp-channel-daily',
  '15 3 * * *',
  $cron$
  SET statement_timeout TO '900000';
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_ga4_vdp_channel_daily;
  $cron$
);

SELECT cron.schedule(
  'refresh-mv-ga4-vdp-channel-monthly',
  '20 3 * * *',
  $cron$
  SET statement_timeout TO '900000';
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_ga4_vdp_channel_monthly;
  $cron$
);

SELECT cron.schedule(
  'refresh-mv-ga4-vdp-channel-yearly',
  '25 3 * * *',
  $cron$
  SET statement_timeout TO '900000';
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_ga4_vdp_channel_yearly;
  $cron$
);
