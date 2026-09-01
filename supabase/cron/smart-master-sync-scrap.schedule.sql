-- Scrap Step 3 cron — scrap_link=on dealers only (4 groups).
-- Independent of Hoot and QS. Deploy edge: smart-master-sync-scrap
-- Deploy RPC: supabase/rpc/build_smart_final_data_scrap.sql

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT jobname FROM cron.job WHERE jobname LIKE 'smart-master-sync-scrap%'
  LOOP
    PERFORM cron.unschedule(r.jobname);
  END LOOP;
END $$;

SELECT cron.schedule(
  'smart-master-sync-scrap',
  '30,45 3 * * *',
  $$
  DO $do$
  DECLARE
    i integer;
    fn_url  text := 'https://rllwmeqingvuohyctddg.supabase.co/functions/v1/smart-master-sync-scrap';
    svc_key text := '__SERVICE_ROLE_KEY__';
  BEGIN
    FOR i IN 1..4 LOOP
      PERFORM net.http_post(
        url := fn_url,
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || svc_key,
          'Content-Type', 'application/json'
        ),
        body := jsonb_build_object('group_id', i, 'group_count', 4, 'days_back', 5)
      );
    END LOOP;
  END $do$;
  $$
);

SELECT cron.schedule(
  'smart-master-sync-scrap-2',
  '0,15,30 4 * * *',
  $$
  DO $do$
  DECLARE
    i integer;
    fn_url  text := 'https://rllwmeqingvuohyctddg.supabase.co/functions/v1/smart-master-sync-scrap';
    svc_key text := '__SERVICE_ROLE_KEY__';
  BEGIN
    FOR i IN 1..4 LOOP
      PERFORM net.http_post(
        url := fn_url,
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || svc_key,
          'Content-Type', 'application/json'
        ),
        body := jsonb_build_object('group_id', i, 'group_count', 4, 'days_back', 5)
      );
    END LOOP;
  END $do$;
  $$
);
