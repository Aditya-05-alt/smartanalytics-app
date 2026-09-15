-- Reschedule Unknown/Other cleanup to 3:00–4:30 PM IST + status email.
-- days_back = 7.

DO $$
DECLARE
  svc_key text;
  base_url text := 'https://rllwmeqingvuohyctddg.supabase.co/functions/v1';
  r record;
  cleanup_cmd text;
  status_cmd text;
BEGIN
  SELECT COALESCE(
    substring(command from $pat$svc_key text := '([^']+)'$pat$),
    substring(command from $pat$'Bearer ([A-Za-z0-9._-]+)'$pat$)
  )
    INTO svc_key
  FROM cron.job
  WHERE jobname IN ('smart-master-sync', 'vdp-filtration', 'smart-master-sync-scrap')
    AND command ~ $pat$svc_key text := '$pat$
  LIMIT 1;

  IF svc_key IS NULL OR length(svc_key) < 20 THEN
    RAISE EXCEPTION 'Could not read service key from existing cron job';
  END IF;

  FOR r IN
    SELECT jobname FROM cron.job
    WHERE jobname LIKE 'logic2-unknown-cleanup%'
  LOOP
    PERFORM cron.unschedule(r.jobname);
  END LOOP;

  cleanup_cmd := format($cmd$
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
$cmd$, base_url || '/logic2-unknown-cleanup', svc_key);

  status_cmd := format($cmd$
SELECT net.http_post(
  url     := %L,
  headers := jsonb_build_object(
    'Authorization', 'Bearer ' || %L,
    'Content-Type',  'application/json'
  ),
  body    := jsonb_build_object(
    'days_back', 7
  )
);
$cmd$, base_url || '/logic2-unknown-cleanup-status', svc_key);

  PERFORM cron.schedule('logic2-unknown-cleanup', '30 9 * * *', cleanup_cmd);
  PERFORM cron.schedule('logic2-unknown-cleanup-2', '0 10 * * *', cleanup_cmd);
  PERFORM cron.schedule('logic2-unknown-cleanup-3', '30 10 * * *', cleanup_cmd);
  PERFORM cron.schedule('logic2-unknown-cleanup-final', '0 11 * * *', cleanup_cmd);
  PERFORM cron.schedule('logic2-unknown-cleanup-status', '5 11 * * *', status_cmd);
END $$;
