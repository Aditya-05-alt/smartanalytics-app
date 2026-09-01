-- QS Step 3 cron — Destination Cycle only (build_smart_final_data_qs).
-- Independent of Hoot and Scrap. Deploy edge: smart-master-sync-qs

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT jobname FROM cron.job WHERE jobname = 'smart-master-sync-qs'
  LOOP
    PERFORM cron.unschedule(r.jobname);
  END LOOP;
END $$;

SELECT cron.schedule(
  'smart-master-sync-qs',
  '50 2 * * *',
  $$
  SELECT net.http_post(
    url := 'https://rllwmeqingvuohyctddg.supabase.co/functions/v1/smart-master-sync-qs',
    headers := jsonb_build_object(
      'Authorization', 'Bearer __SERVICE_ROLE_KEY__',
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('days_back', 7)::jsonb
  ) AS request_id;
  $$
);
