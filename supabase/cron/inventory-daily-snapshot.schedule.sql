-- DEPRECATED — use supabase/cron/inventory-report-pipeline.schedule.sql
-- (single job: inventory-report-pipeline, 9–11 AM IST)
-- Window: 10:30–11:00 AM IST = 05:00–05:30 UTC (15-minute steps).
--
-- Edge inventory-report-daily-sync:
--   smart_hoot_inventory_live → smart_hoot_inventory_daily (+ scrap daily)
--   Frontend reads via get_inventory_report RPC.
--
-- Deploy:
--   1. supabase/rpc/snapshot_inventory_daily.sql
--   2. supabase/rpc/get_inventory_report.sql
--   3. supabase functions deploy inventory-report-daily-sync
--   4. Replace __SERVICE_ROLE_KEY__, run this script.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT jobname FROM cron.job
    WHERE jobname LIKE 'inventory-report-daily-sync%'
       OR jobname LIKE 'inventory-daily-snapshot%'
  LOOP
    PERFORM cron.unschedule(r.jobname);
  END LOOP;
END $$;

-- 10:30 & 10:45 AM IST  →  05:00 & 05:15 UTC
SELECT cron.schedule(
  'inventory-report-daily-sync',
  '0,15 5 * * *',
  $$
  SELECT net.http_post(
    url := 'https://rllwmeqingvuohyctddg.supabase.co/functions/v1/inventory-report-daily-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer __SERVICE_ROLE_KEY__'
    ),
    body := jsonb_build_object('skip_if_complete', true)::jsonb
  ) AS request_id;
  $$
);

-- 11:00 AM IST  →  05:30 UTC
SELECT cron.schedule(
  'inventory-report-daily-sync-2',
  '30 5 * * *',
  $$
  SELECT net.http_post(
    url := 'https://rllwmeqingvuohyctddg.supabase.co/functions/v1/inventory-report-daily-sync',
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
WHERE jobname LIKE 'inventory-report-daily-sync%'
ORDER BY jobname;
