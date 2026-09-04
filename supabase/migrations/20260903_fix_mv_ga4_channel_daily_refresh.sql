-- Fix All Dealers matrix Current Month emptiness.
-- Root cause: full-history REFRESH of mv_ga4_channel_daily timed out (~2 min),
-- so the MV stopped at 2026-08-31 while Current Month uses the daily grain.
--
-- 1) Rebuild daily MV as a rolling 180-day window (enough for MTD / short ranges)
-- 2) Unique index for CONCURRENTLY refresh
-- 3) Longer statement_timeout on cron refresh jobs

DROP MATERIALIZED VIEW IF EXISTS public.mv_ga4_channel_daily CASCADE;

CREATE MATERIALIZED VIEW public.mv_ga4_channel_daily AS
SELECT
  p.client_id,
  p.report_date,
  COALESCE(p.channel, '') AS channel,
  COALESCE(p.ga4_page_type, '') AS ga4_page_type,
  SUM(COALESCE(p.views, 0))::bigint AS views
FROM public.smart_ga4_page_data p
WHERE p.report_date >= ((CURRENT_DATE AT TIME ZONE 'Asia/Kolkata')::date - 180)
GROUP BY p.client_id, p.report_date, COALESCE(p.channel, ''), COALESCE(p.ga4_page_type, '');

CREATE UNIQUE INDEX mv_ga4_channel_daily_uid
  ON public.mv_ga4_channel_daily (client_id, report_date, channel, ga4_page_type);

CREATE INDEX mv_ga4_channel_daily_date_client
  ON public.mv_ga4_channel_daily (report_date, client_id);

COMMENT ON MATERIALIZED VIEW public.mv_ga4_channel_daily IS
  'Rolling 180-day channel×page_type views for All Dealers matrix (Current Month MTD / short ranges). Refresh daily.';

-- Cron: raise timeout so concurrent refresh cannot fail at 2 minutes
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT jobname
    FROM cron.job
    WHERE jobname IN (
      'refresh-mv-ga4-channel-daily',
      'mv_ga4_channel_daily_refresh',
      'refresh-mv-ga4-channel-monthly',
      'refresh-mv-ga4-channel-yearly'
    )
  LOOP
    PERFORM cron.unschedule(r.jobname);
  END LOOP;
END $$;

SELECT cron.schedule(
  'refresh-mv-ga4-channel-daily',
  '0 3 * * *',
  $cron$
  SET statement_timeout TO '900000';
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_ga4_channel_daily;
  $cron$
);

SELECT cron.schedule(
  'refresh-mv-ga4-channel-monthly',
  '5 3 * * *',
  $cron$
  SET statement_timeout TO '900000';
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_ga4_channel_monthly;
  $cron$
);

SELECT cron.schedule(
  'refresh-mv-ga4-channel-yearly',
  '10 3 * * *',
  $cron$
  SET statement_timeout TO '900000';
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_ga4_channel_yearly;
  $cron$
);
