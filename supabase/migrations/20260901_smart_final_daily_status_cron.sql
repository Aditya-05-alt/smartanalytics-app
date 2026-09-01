-- Schedule smart-final-daily-status crons (reuses service key from existing Step 3 cron).
-- Key is stored as: svc_key text := '<jwt>'

DO $$
DECLARE
  svc_key text;
  fn_url text := 'https://rllwmeqingvuohyctddg.supabase.co/functions/v1/smart-final-daily-status';
  r record;
BEGIN
  SELECT COALESCE(
    substring(command from 'svc_key text := ''([^'']+)'''),
    substring(command from 'Bearer ([^''[:space:]]+)')
  )
    INTO svc_key
  FROM cron.job
  WHERE jobname IN ('smart-master-sync', 'smart-master-sync-scrap', 'smart-master-sync-final')
  LIMIT 1;

  IF svc_key IS NULL OR length(svc_key) < 20 THEN
    RAISE EXCEPTION 'Could not read service key from existing Step 3 cron job';
  END IF;

  FOR r IN
    SELECT jobname FROM cron.job WHERE jobname LIKE 'smart-final-daily-status%'
  LOOP
    PERFORM cron.unschedule(r.jobname);
  END LOOP;

  PERFORM cron.schedule(
    'smart-final-daily-status',
    '30 4 * * *',
    format($cmd$
SELECT net.http_post(
  url := %L,
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || %L
  ),
  body := jsonb_build_object('days_back', 7, 'skip_if_sent_today', true)
);
$cmd$, fn_url, svc_key)
  );

  PERFORM cron.schedule(
    'smart-final-daily-status-2',
    '45 4 * * *',
    format($cmd$
SELECT net.http_post(
  url := %L,
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || %L
  ),
  body := jsonb_build_object('days_back', 7, 'skip_if_sent_today', true)
);
$cmd$, fn_url, svc_key)
  );
END $$;
