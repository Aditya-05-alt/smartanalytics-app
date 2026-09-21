-- Refresh Traffic MV once daily after GA4 channel MVs.
-- 9:00 AM IST = 03:30 UTC

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-mv-traffic-dealer-channel-daily') THEN
    PERFORM cron.unschedule('refresh-mv-traffic-dealer-channel-daily');
  END IF;
END $$;

SELECT cron.schedule(
  'refresh-mv-traffic-dealer-channel-daily',
  '30 3 * * *',
  $cron$
  SET statement_timeout TO '900000';
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_traffic_dealer_channel_daily;
  $cron$
);
