-- Hoot Step 3 cron: fire smart-master-sync in 10 dealer groups (fits edge 140s budget).
-- Reuses service role key already embedded in the existing smart-master-sync job.
-- Deploy edge function first: supabase functions deploy smart-master-sync

DO $$
DECLARE
  svc_key text;
  fn_url text := 'https://rllwmeqingvuohyctddg.supabase.co/functions/v1/smart-master-sync';
  r record;
BEGIN
  SELECT substring(command from 'Bearer ([^'']+)')
    INTO svc_key
  FROM cron.job
  WHERE jobname = 'smart-master-sync'
  LIMIT 1;

  IF svc_key IS NULL OR length(svc_key) < 20 THEN
    RAISE EXCEPTION 'Could not read service key from existing smart-master-sync cron job';
  END IF;

  FOR r IN
    SELECT jobname FROM cron.job
    WHERE jobname IN ('smart-master-sync', 'smart-master-sync-final')
  LOOP
    PERFORM cron.unschedule(r.jobname);
  END LOOP;

  PERFORM cron.schedule(
    'smart-master-sync',
    '15,30,45 2 * * *',
    format($cmd$
DO $do$
DECLARE
  i integer;
  fn_url  text := %L;
  svc_key text := %L;
BEGIN
  FOR i IN 1..10 LOOP
    PERFORM net.http_post(
      url     := fn_url,
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || svc_key,
        'Content-Type',  'application/json'
      ),
      body    := jsonb_build_object(
        'group_id',    i,
        'group_count', 10,
        'days_back',   7
      )
    );
  END LOOP;
END $do$;
$cmd$, fn_url, svc_key)
  );

  PERFORM cron.schedule(
    'smart-master-sync-final',
    '0,15 3 * * *',
    format($cmd$
DO $do$
DECLARE
  i integer;
  fn_url  text := %L;
  svc_key text := %L;
BEGIN
  FOR i IN 1..10 LOOP
    PERFORM net.http_post(
      url     := fn_url,
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || svc_key,
        'Content-Type',  'application/json'
      ),
      body    := jsonb_build_object(
        'group_id',    i,
        'group_count', 10,
        'days_back',   7
      )
    );
  END LOOP;
END $do$;
$cmd$, fn_url, svc_key)
  );
END $$;
