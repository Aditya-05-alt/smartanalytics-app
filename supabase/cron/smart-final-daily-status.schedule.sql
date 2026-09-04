-- Smart Analytics Data Update daily email
-- Edge: smart-final-daily-status
-- 10:30 AM IST = 05:00 UTC
-- 10:45 AM IST = 05:15 UTC (retry)

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

-- 10:30 AM IST → 05:00 UTC
SELECT cron.schedule(
  'smart-final-daily-status',
  '0 5 * * *',
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

-- 10:45 AM IST → 05:15 UTC (retry)
SELECT cron.schedule(
  'smart-final-daily-status-2',
  '15 5 * * *',
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
