-- Inventory daily snapshot cron — runs AFTER live hoot + scrap inventory sync.
-- Window: 10:30–11:00 AM IST = 05:00–05:30 UTC (15-minute steps).
--
-- Edge function inventory-daily-snapshot:
--   • Calls run_daily_inventory_snapshot (insert-only, pull_date + sk)
--   • Fills smart_hoot_inventory_daily + smart_scrap_inventory_daily
--
-- Deploy:
--   1. Deploy RPC: supabase/rpc/snapshot_inventory_daily.sql
--   2. Deploy edge:  supabase functions deploy inventory-daily-snapshot
--   3. Replace __SERVICE_ROLE_KEY__ below, then run this script.
--
-- Requires: pg_cron, pg_net (same as smart-master-sync jobs).

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT jobname FROM cron.job WHERE jobname LIKE 'inventory-daily-snapshot%'
  LOOP
    PERFORM cron.unschedule(r.jobname);
  END LOOP;
END $$;

-- 10:30 & 10:45 AM IST  →  05:00 & 05:15 UTC
SELECT cron.schedule(
  'inventory-daily-snapshot',
  '0,15 5 * * *',
  $$
  SELECT net.http_post(
    url := 'https://rllwmeqingvuohyctddg.supabase.co/functions/v1/inventory-daily-snapshot',
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
  'inventory-daily-snapshot-2',
  '30 5 * * *',
  $$
  SELECT net.http_post(
    url := 'https://rllwmeqingvuohyctddg.supabase.co/functions/v1/inventory-daily-snapshot',
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
WHERE jobname LIKE 'inventory-daily-snapshot%'
ORDER BY jobname;
