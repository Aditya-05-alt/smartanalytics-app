-- Step 2 + Step 3 cron hardening (safe additive):
-- 1) Step 2 (smart-ga4-filteration) posts in 15 groups so every dealer is covered
-- 2) Step 3 Hoot uses 15 groups + ~2.5h retry window (02:15–04:45 UTC)
-- 3) Scrap uses 6 groups + wider retries
-- Matching RPCs / VDP regex logic are unchanged.
--
-- Reuses service role key from existing Step 3 cron job.

DO $$
DECLARE
  svc_key text;
  base_url text := 'https://rllwmeqingvuohyctddg.supabase.co/functions/v1';
  r record;
BEGIN
  SELECT substring(command from 'Bearer ([^'']+)')
    INTO svc_key
  FROM cron.job
  WHERE jobname IN ('smart-master-sync', 'vdp-filtration', 'smart-master-sync-scrap')
  LIMIT 1;

  IF svc_key IS NULL OR length(svc_key) < 20 THEN
    RAISE EXCEPTION 'Could not read service key from existing Step 2/3 cron job';
  END IF;

  FOR r IN
    SELECT jobname FROM cron.job
    WHERE jobname IN (
      'vdp-filtration',
      'vdp-filtration-final',
      'smart-master-sync',
      'smart-master-sync-final',
      'smart-master-sync-qs',
      'smart-master-sync-scrap',
      'smart-master-sync-scrap-2'
    )
  LOOP
    PERFORM cron.unschedule(r.jobname);
  END LOOP;

  -- ========== STEP 2 ==========
  -- 6:30–7:15 AM IST → 01:00/15/30/45 UTC — 15 parallel groups each wave
  PERFORM cron.schedule(
    'vdp-filtration',
    '0,15,30,45 1 * * *',
    format($cmd$
DO $do$
DECLARE
  i integer;
  fn_url  text := %L;
  svc_key text := %L;
BEGIN
  FOR i IN 1..15 LOOP
    PERFORM net.http_post(
      url     := fn_url,
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || svc_key,
        'Content-Type',  'application/json'
      ),
      body    := jsonb_build_object(
        'group_id',    i,
        'group_count', 15,
        'days_back',   7
      )
    );
  END LOOP;
END $do$;
$cmd$, base_url || '/smart-ga4-filteration', svc_key)
  );

  -- Final Step 2 sweep before Step 3: 7:30 AM IST → 02:00 UTC
  PERFORM cron.schedule(
    'vdp-filtration-final',
    '0 2 * * *',
    format($cmd$
DO $do$
DECLARE
  i integer;
  fn_url  text := %L;
  svc_key text := %L;
BEGIN
  FOR i IN 1..15 LOOP
    PERFORM net.http_post(
      url     := fn_url,
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || svc_key,
        'Content-Type',  'application/json'
      ),
      body    := jsonb_build_object(
        'group_id',    i,
        'group_count', 15,
        'days_back',   7
      )
    );
  END LOOP;
END $do$;
$cmd$, base_url || '/smart-ga4-filteration', svc_key)
  );

  -- ========== STEP 3 HOOT (~2.5h window) ==========
  -- 7:45 AM–10:15 AM IST → 02:15–04:45 UTC (:15/:30/:45 each hour)
  -- Each invoke also runs Step 2 for that dealer before build (code change).
  PERFORM cron.schedule(
    'smart-master-sync',
    '15,30,45 2-4 * * *',
    format($cmd$
DO $do$
DECLARE
  i integer;
  fn_url  text := %L;
  svc_key text := %L;
BEGIN
  FOR i IN 1..15 LOOP
    PERFORM net.http_post(
      url     := fn_url,
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || svc_key,
        'Content-Type',  'application/json'
      ),
      body    := jsonb_build_object(
        'group_id',    i,
        'group_count', 15,
        'days_back',   7,
        'run_step2',   true
      )
    );
  END LOOP;
END $do$;
$cmd$, base_url || '/smart-master-sync', svc_key)
  );

  -- Extra :00 retries in the middle/end of the window
  PERFORM cron.schedule(
    'smart-master-sync-final',
    '0 3-4 * * *',
    format($cmd$
DO $do$
DECLARE
  i integer;
  fn_url  text := %L;
  svc_key text := %L;
BEGIN
  FOR i IN 1..15 LOOP
    PERFORM net.http_post(
      url     := fn_url,
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || svc_key,
        'Content-Type',  'application/json'
      ),
      body    := jsonb_build_object(
        'group_id',    i,
        'group_count', 15,
        'days_back',   7,
        'run_step2',   true
      )
    );
  END LOOP;
END $do$;
$cmd$, base_url || '/smart-master-sync', svc_key)
  );

  -- QS after first Step 3 wave starts
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
  body    := jsonb_build_object('days_back', 7, 'run_step2', true)
);
$cmd$, base_url || '/smart-master-sync-qs', svc_key)
  );

  -- ========== STEP 3 SCRAP ==========
  -- Primary: 9:00 / 9:15 AM IST → 03:30 / 03:45 UTC, 6 groups
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
  FOR i IN 1..6 LOOP
    PERFORM net.http_post(
      url     := fn_url,
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || svc_key,
        'Content-Type',  'application/json'
      ),
      body    := jsonb_build_object(
        'group_id',    i,
        'group_count', 6,
        'days_back',   7,
        'run_step2',   true
      )
    );
  END LOOP;
END $do$;
$cmd$, base_url || '/smart-master-sync-scrap', svc_key)
  );

  -- Retries: 9:30–10:45 AM IST → 04:00–05:15 UTC
  PERFORM cron.schedule(
    'smart-master-sync-scrap-2',
    '0,15,30,45 4 * * *',
    format($cmd$
DO $do$
DECLARE
  i integer;
  fn_url  text := %L;
  svc_key text := %L;
BEGIN
  FOR i IN 1..6 LOOP
    PERFORM net.http_post(
      url     := fn_url,
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || svc_key,
        'Content-Type',  'application/json'
      ),
      body    := jsonb_build_object(
        'group_id',    i,
        'group_count', 6,
        'days_back',   7,
        'run_step2',   true
      )
    );
  END LOOP;
END $do$;
$cmd$, base_url || '/smart-master-sync-scrap', svc_key)
  );
END $$;
