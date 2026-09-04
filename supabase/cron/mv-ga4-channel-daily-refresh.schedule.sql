-- Refresh All Dealers channel MVs once daily in the 8:30–9:30 AM IST window.
-- 8:30 AM IST = 03:00 UTC
-- statement_timeout raised: full refresh was canceling at ~2 minutes and
-- leaving mv_ga4_channel_daily stale (Current Month matrix empty).

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
