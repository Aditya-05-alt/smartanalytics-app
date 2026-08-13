-- Scrap dealers daily transfer report (Google SMTP email).
-- Edge scrap-dealers-daily-status:
--   • Lists every scrap_link = on dealer (all ~21 names)
--   • Scrap from smart_scrap_inventory_daily TODAY (fallback last_seen today)
--   • Emails YES/NO + units via Google SMTP
--   • Writes smart_scrap_daily_status
--
-- Window: after scrap sync + inventory snapshot
--   11:30 AM IST = 06:00 UTC
--   12:00 PM IST = 06:30 UTC (retry)
--
-- Deploy:
--   1. supabase/rpc/snapshot_scrap_dealers_daily_status.sql
--   2. supabase functions deploy scrap-dealers-daily-status
--   3. Replace __SERVICE_ROLE_KEY__, run this script.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT jobname FROM cron.job
    WHERE jobname LIKE 'scrap-dealers-daily-status%'
  LOOP
    PERFORM cron.unschedule(r.jobname);
  END LOOP;
END $$;

-- 11:30 AM IST → 06:00 UTC
SELECT cron.schedule(
  'scrap-dealers-daily-status',
  '0 6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://rllwmeqingvuohyctddg.supabase.co/functions/v1/scrap-dealers-daily-status',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer __SERVICE_ROLE_KEY__'
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

-- 12:00 PM IST → 06:30 UTC
SELECT cron.schedule(
  'scrap-dealers-daily-status-2',
  '30 6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://rllwmeqingvuohyctddg.supabase.co/functions/v1/scrap-dealers-daily-status',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer __SERVICE_ROLE_KEY__'
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname LIKE 'scrap-dealers-daily-status%'
ORDER BY jobname;
