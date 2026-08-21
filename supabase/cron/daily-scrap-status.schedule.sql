-- Scrap dealers daily status email (Google SMTP).
-- Edge function: daily-scrap-status
--   https://rllwmeqingvuohyctddg.supabase.co/functions/v1/daily-scrap-status
--
-- Window: after scrap daily snapshot (inventory-report-daily-sync ~10:30–11:00 AM IST)
--   11:30 AM IST = 06:00 UTC
--   12:00 PM IST = 06:30 UTC (retry, skip if already sent today)
--
-- Deploy:
--   1. supabase functions deploy daily-scrap-status
--   2. Replace __SERVICE_ROLE_KEY__, run this script.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT jobname FROM cron.job
    WHERE jobname LIKE 'daily-scrap-status%'
       OR jobname LIKE 'scrap-dealers-daily-status%'
  LOOP
    PERFORM cron.unschedule(r.jobname);
  END LOOP;
END $$;

-- 11:30 AM IST → 06:00 UTC
SELECT cron.schedule(
  'daily-scrap-status',
  '0 6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://rllwmeqingvuohyctddg.supabase.co/functions/v1/daily-scrap-status',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer __SERVICE_ROLE_KEY__'
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

-- 12:00 PM IST → 06:30 UTC (retry)
SELECT cron.schedule(
  'daily-scrap-status-retry',
  '30 6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://rllwmeqingvuohyctddg.supabase.co/functions/v1/daily-scrap-status',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer __SERVICE_ROLE_KEY__'
    ),
    body := jsonb_build_object('skip_if_sent_today', true)::jsonb
  ) AS request_id;
  $$
);

SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname LIKE 'daily-scrap-status%'
ORDER BY jobname;
