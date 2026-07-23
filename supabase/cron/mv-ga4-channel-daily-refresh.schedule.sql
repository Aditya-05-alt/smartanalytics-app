-- Refresh All Dealers channel MV once daily in the 8:30–9:30 AM IST window.
-- 8:30 AM IST = 03:00 UTC
--
-- Requires: pg_cron + unique index on mv_ga4_channel_daily (for CONCURRENTLY).
-- Deploy: run this in Supabase SQL editor.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT jobname
    FROM cron.job
    WHERE jobname IN (
      'refresh-mv-ga4-channel-daily',
      'mv_ga4_channel_daily_refresh'
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
