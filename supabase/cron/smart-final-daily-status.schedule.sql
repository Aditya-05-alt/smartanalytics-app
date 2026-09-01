-- Smart Final Data daily status email (Google SMTP).
-- Edge: smart-final-daily-status
--   • Lists every active GA4 dealer
--   • smart_final_data coverage for last 7 report_dates + rebuilt today
--   • Emails YES/NO + row/matched counts via Google SMTP
--
-- Window: after Step 3 (Hoot/QS/Scrap)
--   10:00 AM IST = 04:30 UTC
--   10:15 AM IST = 04:45 UTC (retry)
--
-- Deploy:
--   1. supabase/rpc/get_smart_final_daily_status.sql
--   2. supabase functions deploy smart-final-daily-status
--   3. Set Edge secret SMTP_PASS (Google app password) if not already
--   4. Replace __SERVICE_ROLE_KEY__ OR use migration that reuses existing cron key

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT jobname FROM cron.job
    WHERE jobname LIKE 'smart-final-daily-status%'
  LOOP
    PERFORM cron.unschedule(r.jobname);
  END LOOP;
END $$;

-- 10:00 AM IST → 04:30 UTC
SELECT cron.schedule(
  'smart-final-daily-status',
  '30 4 * * *',
  $$
  SELECT net.http_post(
    url := 'https://rllwmeqingvuohyctddg.supabase.co/functions/v1/smart-final-daily-status',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer __SERVICE_ROLE_KEY__'
    ),
    body := jsonb_build_object('days_back', 7, 'skip_if_sent_today', true)::jsonb
  ) AS request_id;
  $$
);

-- 10:15 AM IST → 04:45 UTC (retry / catch late scrap)
SELECT cron.schedule(
  'smart-final-daily-status-2',
  '45 4 * * *',
  $$
  SELECT net.http_post(
    url := 'https://rllwmeqingvuohyctddg.supabase.co/functions/v1/smart-final-daily-status',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer __SERVICE_ROLE_KEY__'
    ),
    body := jsonb_build_object('days_back', 7, 'skip_if_sent_today', true)::jsonb
  ) AS request_id;
  $$
);

SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname LIKE 'smart-final-daily-status%'
ORDER BY jobname;
