-- Refresh All Dealers channel MVs once daily in the 8:30–9:30 AM IST window.
-- 8:30 AM IST = 03:00 UTC
--
-- Requires: pg_cron + unique indexes on each MV (for CONCURRENTLY).
-- Deploy: run this in Supabase SQL editor after creating the MVs.

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
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_ga4_channel_daily;$$
);

SELECT cron.schedule(
  'refresh-mv-ga4-channel-monthly',
  '5 3 * * *',
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_ga4_channel_monthly;$$
);

SELECT cron.schedule(
  'refresh-mv-ga4-channel-yearly',
  '10 3 * * *',
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_ga4_channel_yearly;$$
);
