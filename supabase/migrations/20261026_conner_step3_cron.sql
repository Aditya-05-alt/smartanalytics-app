-- Conner (Scout RV / ScoutX) daily pipeline.
--   smart-conner-inventory-sync  7:15 AM IST (01:45 UTC) + 7:40 AM IST retry (02:10 UTC);
--                                dealers already loaded that day are skipped.
--   smart-conner-final-data      8:25 AM–10:25 AM IST (02:25–04:55 UTC, :25/:55), 3 queue workers.
-- Hoot (smart-master-sync) and Scrap (smart-master-sync-scrap) Step 3 skip Conner dealers.
--
-- Reuses the service role key from the existing Step 3 cron job.

DO $$
DECLARE
  svc_key  text;
  base_url text := 'https://rllwmeqingvuohyctddg.supabase.co/functions/v1';
  r        record;
BEGIN
  -- Existing jobs embed the key either inline after "Bearer " or as `svc_key text := '...'`.
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

  FOR r IN
    SELECT jobname FROM cron.job
    WHERE jobname IN (
      'smart-conner-inventory-sync',
      'smart-conner-inventory-sync-2',
      'smart-conner-final-data'
    )
  LOOP
    PERFORM cron.unschedule(r.jobname);
  END LOOP;

  PERFORM cron.schedule(
    'smart-conner-inventory-sync',
    '45 1 * * *',
    format($cmd$
SELECT net.http_post(
  url     := %L,
  headers := jsonb_build_object(
    'Authorization', 'Bearer ' || %L,
    'Content-Type',  'application/json'
  ),
  body    := '{}'::jsonb,
  timeout_milliseconds := 150000
);
$cmd$, base_url || '/smart-conner-inventory-sync', svc_key)
  );

  PERFORM cron.schedule(
    'smart-conner-inventory-sync-2',
    '10 2 * * *',
    format($cmd$
SELECT net.http_post(
  url     := %L,
  headers := jsonb_build_object(
    'Authorization', 'Bearer ' || %L,
    'Content-Type',  'application/json'
  ),
  body    := '{}'::jsonb,
  timeout_milliseconds := 150000
);
$cmd$, base_url || '/smart-conner-inventory-sync', svc_key)
  );

  PERFORM cron.schedule(
    'smart-conner-final-data',
    '25,55 2-4 * * *',
    format($cmd$
DO $do$
DECLARE
  i integer;
  fn_url  text := %L;
  svc_key text := %L;
BEGIN
  FOR i IN 1..3 LOOP
    PERFORM net.http_post(
      url     := fn_url,
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || svc_key,
        'Content-Type',  'application/json'
      ),
      body    := jsonb_build_object(
        'queue',     true,
        'group_id',  i,
        'days_back', 7
      ),
      timeout_milliseconds := 150000
    );
  END LOOP;
END $do$;
$cmd$, base_url || '/smart-conner-final-data', svc_key)
  );
END $$;

SELECT jobname, schedule, active
FROM cron.job
WHERE jobname LIKE 'smart-conner-%'
ORDER BY jobname;
