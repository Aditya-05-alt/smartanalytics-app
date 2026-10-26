-- Conner dealers daily status email (edge function daily-conner-status).
--   11:00 AM IST = 05:30 UTC (after smart-conner-final-data's last run at 04:55 UTC)
--   11:30 AM IST = 06:00 UTC retry, skipped when today's email already went out
--
-- Reuses the service role key from the existing Step 3 cron job.

DO $$
DECLARE
  svc_key text;
  fn_url  text := 'https://rllwmeqingvuohyctddg.supabase.co/functions/v1/daily-conner-status';
  r       record;
BEGIN
  SELECT COALESCE(
           substring(command from 'svc_key\s+text\s*:=\s*''([^'']+)'''),
           substring(command from 'Bearer ([^'']+)')
         )
    INTO svc_key
  FROM cron.job
  WHERE jobname IN ('smart-master-sync', 'smart-master-sync-scrap')
  ORDER BY jobname
  LIMIT 1;

  IF svc_key IS NULL OR length(svc_key) < 20 THEN
    RAISE EXCEPTION 'Could not read service key from existing Step 3 cron job';
  END IF;

  FOR r IN SELECT jobname FROM cron.job WHERE jobname LIKE 'daily-conner-status%' LOOP
    PERFORM cron.unschedule(r.jobname);
  END LOOP;

  PERFORM cron.schedule(
    'daily-conner-status',
    '30 5 * * *',
    format($cmd$
SELECT net.http_post(
  url     := %L,
  headers := jsonb_build_object(
    'Authorization', 'Bearer ' || %L,
    'Content-Type',  'application/json'
  ),
  body    := '{}'::jsonb
);
$cmd$, fn_url, svc_key)
  );

  PERFORM cron.schedule(
    'daily-conner-status-retry',
    '0 6 * * *',
    format($cmd$
SELECT net.http_post(
  url     := %L,
  headers := jsonb_build_object(
    'Authorization', 'Bearer ' || %L,
    'Content-Type',  'application/json'
  ),
  body    := jsonb_build_object('skip_if_sent_today', true)
);
$cmd$, fn_url, svc_key)
  );
END $$;

SELECT jobname, schedule, active
FROM cron.job
WHERE jobname LIKE 'daily-conner-status%'
ORDER BY jobname;
