-- DEPRECATED — use supabase/cron/inventory-report-pipeline.schedule.sql
-- Window: 9:30–10:15 AM IST = 04:00–04:45 UTC (15-minute steps).
--
-- Edge smart-hoot-inv-live:
--   smart_hoot_config.hoot_url → smart_hoot_inventory_live (TRUNCATE + INSERT)
--
-- Deploy:
--   1. supabase/migrations/smart_hoot_inventory_live.sql
--   2. supabase functions deploy smart-hoot-inv-live
--   3. Replace __SERVICE_ROLE_KEY__, run this script.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT jobname FROM cron.job
    WHERE jobname LIKE 'smart-hoot-inv-live%'
       OR jobname LIKE 'hoot-inventory-live-sync%'
  LOOP
    PERFORM cron.unschedule(r.jobname);
  END LOOP;
END $$;

-- 9:30 & 9:45 AM IST  →  04:00 & 04:15 UTC
SELECT cron.schedule(
  'smart-hoot-inv-live',
  '0,15 4 * * *',
  $$
  SELECT net.http_post(
    url := 'https://rllwmeqingvuohyctddg.supabase.co/functions/v1/smart-hoot-inv-live',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer __SERVICE_ROLE_KEY__'
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

-- 10:00 & 10:15 AM IST  →  04:30 & 04:45 UTC
SELECT cron.schedule(
  'smart-hoot-inv-live-2',
  '30,45 4 * * *',
  $$
  SELECT net.http_post(
    url := 'https://rllwmeqingvuohyctddg.supabase.co/functions/v1/smart-hoot-inv-live',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer __SERVICE_ROLE_KEY__'
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname LIKE 'smart-hoot-inv-live%'
ORDER BY jobname;
