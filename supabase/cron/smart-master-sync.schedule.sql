-- Hoot Step 3 cron — 10 dealer groups. Independent of QS and Scrap.
-- Replace __SERVICE_ROLE_KEY__ then run in Supabase SQL editor OR use migration
-- 20260901_step3_independent_crons.sql (reads key from existing cron).

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
  '15,30,45 2 * * *',
  $$
  DO $do$
  DECLARE
    i integer;
    fn_url  text := 'https://rllwmeqingvuohyctddg.supabase.co/functions/v1/smart-master-sync';
    svc_key text := '__SERVICE_ROLE_KEY__';
  BEGIN
    FOR i IN 1..10 LOOP
      PERFORM net.http_post(
        url := fn_url,
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || svc_key,
          'Content-Type', 'application/json'
        ),
        body := jsonb_build_object('group_id', i, 'group_count', 10, 'days_back', 7)
      );
    END LOOP;
  END $do$;
  $$
);

SELECT cron.schedule(
  'smart-master-sync-final',
  '0,15 3 * * *',
  $$
  DO $do$
  DECLARE
    i integer;
    fn_url  text := 'https://rllwmeqingvuohyctddg.supabase.co/functions/v1/smart-master-sync';
    svc_key text := '__SERVICE_ROLE_KEY__';
  BEGIN
    FOR i IN 1..10 LOOP
      PERFORM net.http_post(
        url := fn_url,
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || svc_key,
          'Content-Type', 'application/json'
        ),
        body := jsonb_build_object('group_id', i, 'group_count', 10, 'days_back', 7)
      );
    END LOOP;
  END $do$;
  $$
);
