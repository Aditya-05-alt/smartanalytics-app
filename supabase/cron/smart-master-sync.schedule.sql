-- Hoot Step 3 cron — 15 dealer groups, ~2.5h window.
-- Each invoke also runs Step 2 for that dealer (smart-master-sync run_step2=true).
-- Replace __SERVICE_ROLE_KEY__ then run in SQL editor OR use migration
-- 20260907_step2_step3_cron_hardening.sql (reads key from existing cron).

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT jobname FROM cron.job
    WHERE jobname IN ('smart-master-sync', 'smart-master-sync-final')
  LOOP
    PERFORM cron.unschedule(r.jobname);
  END LOOP;
END $$;

SELECT cron.schedule(
  'smart-master-sync',
  '15,30,45 2-4 * * *',
  $$
  DO $do$
  DECLARE
    i integer;
    fn_url  text := 'https://rllwmeqingvuohyctddg.supabase.co/functions/v1/smart-master-sync';
    svc_key text := '__SERVICE_ROLE_KEY__';
  BEGIN
    FOR i IN 1..15 LOOP
      PERFORM net.http_post(
        url := fn_url,
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || svc_key,
          'Content-Type', 'application/json'
        ),
        body := jsonb_build_object(
          'group_id', i,
          'group_count', 15,
          'days_back', 7,
          'run_step2', true
        )
      );
    END LOOP;
  END $do$;
  $$
);

SELECT cron.schedule(
  'smart-master-sync-final',
  '0 3-4 * * *',
  $$
  DO $do$
  DECLARE
    i integer;
    fn_url  text := 'https://rllwmeqingvuohyctddg.supabase.co/functions/v1/smart-master-sync';
    svc_key text := '__SERVICE_ROLE_KEY__';
  BEGIN
    FOR i IN 1..15 LOOP
      PERFORM net.http_post(
        url := fn_url,
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || svc_key,
          'Content-Type', 'application/json'
        ),
        body := jsonb_build_object(
          'group_id', i,
          'group_count', 15,
          'days_back', 7,
          'run_step2', true
        )
      );
    END LOOP;
  END $do$;
  $$
);
