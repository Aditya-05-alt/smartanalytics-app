-- Inventory report pipeline — ONE cron job, 9:00–11:00 AM IST (with retries).
--
-- Edge inventory-report-pipeline runs in order:
--   1. smart-hoot-inv-live        → smart_hoot_inventory_live
--   2. inventory-report-daily-sync → smart_hoot_inventory_daily (+ scrap)
--
-- Schedule (UTC → IST):
--   03:30 UTC =  9:00 AM IST
--   04:00 UTC =  9:30 AM IST
--   04:30 UTC = 10:00 AM IST
--   05:00 UTC = 10:30 AM IST
--   05:30 UTC = 11:00 AM IST
--
-- Deploy edges:
--   supabase functions deploy smart-hoot-inv-live
--   supabase functions deploy inventory-report-daily-sync
--   supabase functions deploy inventory-report-pipeline
--
-- Then replace __SERVICE_ROLE_KEY__ and run this script.
-- Also disable/delete old jobs: inventory-daily-snapshot, inventory-daily-snapshot-2

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT jobname FROM cron.job
    WHERE jobname LIKE 'inventory-%'
       OR jobname LIKE 'smart-hoot-%'
       OR jobname LIKE 'hoot-inventory-%'
  LOOP
    PERFORM cron.unschedule(r.jobname);
  END LOOP;
END $$;

-- Single job — runs at 8:30, 9:00, 9:30, 10:00, 10:30, 11:00 AM IST
-- (0,30 minutes during UTC hours 3–5)
SELECT cron.schedule(
  'inventory-report-pipeline',
  '0,30 3-5 * * *',
  $$
  SELECT net.http_post(
    url := 'https://rllwmeqingvuohyctddg.supabase.co/functions/v1/inventory-report-pipeline',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer __SERVICE_ROLE_KEY__'
    ),
    body := jsonb_build_object('skip_if_complete', true)::jsonb
  ) AS request_id;
  $$
);

SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname = 'inventory-report-pipeline';
