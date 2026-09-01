-- Step 3 crons (independent):
--   smart-master-sync       → Hoot build_smart_final_data (10 groups)
--   smart-master-sync-final → Hoot retry (10 groups)
--   smart-master-sync-qs    → Destination Cycle build_smart_final_data_qs
--   smart-master-sync-scrap → Scrap build_smart_final_data_scrap (4 groups)
--
-- Reuses service role key already embedded in the existing smart-master-sync job.
-- Deploy edge functions FIRST:
--   smart-master-sync, smart-master-sync-qs, smart-master-sync-scrap

DO $$
DECLARE
  svc_key text;
  base_url text := 'https://rllwmeqingvuohyctddg.supabase.co/functions/v1';
  r record;
BEGIN
  SELECT substring(command from 'Bearer ([^'']+)')
    INTO svc_key
  FROM cron.job
  WHERE jobname IN ('smart-master-sync', 'smart-master-sync-scrap')
  LIMIT 1;

  IF svc_key IS NULL OR length(svc_key) < 20 THEN
    RAISE EXCEPTION 'Could not read service key from existing Step 3 cron job';
  END IF;

  FOR r IN
    SELECT jobname FROM cron.job
    WHERE jobname IN (
      'smart-master-sync',
      'smart-master-sync-final',
      'smart-master-sync-qs',
      'smart-master-sync-scrap',
      'smart-master-sync-scrap-2'
    )
  LOOP
    PERFORM cron.unschedule(r.jobname);
  END LOOP;

  -- Hoot: 7:45 / 8:00 / 8:15 AM IST → 02:15 / 02:30 / 02:45 UTC
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
$cmd$, base_url || '/smart-master-sync', svc_key)
  );

  -- Hoot retry: 8:30 / 8:45 AM IST → 03:00 / 03:15 UTC
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
$cmd$, base_url || '/smart-master-sync', svc_key)
  );

  -- QS (Destination Cycle): 8:20 AM IST → 02:50 UTC (after first hoot wave starts)
  PERFORM cron.schedule(
    'smart-master-sync-qs',
    '50 2 * * *',
    format($cmd$
SELECT net.http_post(
  url     := %L,
  headers := jsonb_build_object(
    'Authorization', 'Bearer ' || %L,
    'Content-Type',  'application/json'
  ),
  body    := jsonb_build_object('days_back', 7)
);
$cmd$, base_url || '/smart-master-sync-qs', svc_key)
  );

  -- Scrap: 9:00 / 9:15 AM IST → 03:30 / 03:45 UTC (4 groups)
  PERFORM cron.schedule(
    'smart-master-sync-scrap',
    '30,45 3 * * *',
    format($cmd$
DO $do$
DECLARE
  i integer;
  fn_url  text := %L;
  svc_key text := %L;
BEGIN
  FOR i IN 1..4 LOOP
    PERFORM net.http_post(
      url     := fn_url,
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || svc_key,
        'Content-Type',  'application/json'
      ),
      body    := jsonb_build_object(
        'group_id',    i,
        'group_count', 4,
        'days_back',   5
      )
    );
  END LOOP;
END $do$;
$cmd$, base_url || '/smart-master-sync-scrap', svc_key)
  );

  -- Scrap retry: 9:30 / 9:45 / 10:00 AM IST → 04:00 / 04:15 / 04:30 UTC
  PERFORM cron.schedule(
    'smart-master-sync-scrap-2',
    '0,15,30 4 * * *',
    format($cmd$
DO $do$
DECLARE
  i integer;
  fn_url  text := %L;
  svc_key text := %L;
BEGIN
  FOR i IN 1..4 LOOP
    PERFORM net.http_post(
      url     := fn_url,
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || svc_key,
        'Content-Type',  'application/json'
      ),
      body    := jsonb_build_object(
        'group_id',    i,
        'group_count', 4,
        'days_back',   5
      )
    );
  END LOOP;
END $do$;
$cmd$, base_url || '/smart-master-sync-scrap', svc_key)
  );
END $$;
