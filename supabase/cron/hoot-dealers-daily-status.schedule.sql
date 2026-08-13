-- Hoot dealers daily transfer report (Google SMTP email).
-- Edge hoot-dealers-daily-status:
--   • Lists every active dealer with hoot_url
--   • Counts smart_hoot_inventory rows upserted today (last_seen / first_seen IST)
--   • Emails YES/NO + row counts via Google SMTP
--   • Writes smart_hoot_daily_status
--
-- Window: after Hoot inventory sync
--   10:30 AM IST = 05:00 UTC
--   11:00 AM IST = 05:30 UTC (retry)
--
-- Deploy:
--   1. supabase/rpc/snapshot_hoot_dealers_daily_status.sql
--   2. supabase/rpc/smart_inventory_email_log.sql (if not already)
--   3. supabase functions deploy hoot-dealers-daily-status
--   4. Replace __SERVICE_ROLE_KEY__, run this script.
--   5. Set Edge secret SMTP_PASS (Google app password)

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT jobname FROM cron.job
    WHERE jobname LIKE 'hoot-dealers-daily-status%'
  LOOP
    PERFORM cron.unschedule(r.jobname);
  END LOOP;
END $$;

-- 10:30 AM IST → 05:00 UTC
SELECT cron.schedule(
  'hoot-dealers-daily-status',
  '0 5 * * *',
  $$
  SELECT net.http_post(
    url := 'https://rllwmeqingvuohyctddg.supabase.co/functions/v1/hoot-dealers-daily-status',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer __SERVICE_ROLE_KEY__'
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

-- 11:00 AM IST → 05:30 UTC
SELECT cron.schedule(
  'hoot-dealers-daily-status-2',
  '30 5 * * *',
  $$
  SELECT net.http_post(
    url := 'https://rllwmeqingvuohyctddg.supabase.co/functions/v1/hoot-dealers-daily-status',
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
WHERE jobname LIKE 'hoot-dealers-daily-status%'
ORDER BY jobname;
