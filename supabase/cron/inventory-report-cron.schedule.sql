-- Inventory report cron — TWO jobs (hoot live FIRST, snapshot SECOND).
-- Window: 9:00–11:00 AM IST.
--
-- SS2 (first):  smart-hoot-inv-live        → smart_hoot_inventory_live
-- SS1 (second): inventory-report-daily-sync → smart_hoot_inventory_daily
--
-- Replace __SERVICE_ROLE_KEY__ then run in Supabase SQL Editor.

-- Remove old / pipeline jobs
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

-- ── SS2 FIRST: smart-hoot-inv-live (9:00, 9:30, 10:00 AM IST) ───────────────
-- 03:30 UTC = 9:00 AM IST
-- 04:00 UTC = 9:30 AM IST
-- 04:30 UTC = 10:00 AM IST

SELECT cron.schedule(
  'smart-hoot-inv-live',
  '30 3 * * *',
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

SELECT cron.schedule(
  'smart-hoot-inv-live-2',
  '0 4 * * *',
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

SELECT cron.schedule(
  'smart-hoot-inv-live-3',
  '30 4 * * *',
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

-- ── SS1 SECOND: inventory-report-daily-sync (10:30, 10:45, 11:00 AM IST) ───
-- 05:00 UTC = 10:30 AM IST
-- 05:15 UTC = 10:45 AM IST
-- 05:30 UTC = 11:00 AM IST

SELECT cron.schedule(
  'inventory-report-daily-sync',
  '0 5 * * *',
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

SELECT cron.schedule(
  'inventory-report-daily-sync-2',
  '15 5 * * *',
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

SELECT cron.schedule(
  'inventory-report-daily-sync-3',
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

-- Verify
SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname LIKE 'smart-hoot-inv-live%'
   OR jobname LIKE 'inventory-report-daily-sync%'
ORDER BY jobname;
