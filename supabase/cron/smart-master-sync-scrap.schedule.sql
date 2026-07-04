-- Scrap Step 3 cron — runs AFTER hoot smart-master-sync + smart-master-sync-final.
-- Window: 9:00–10:00 AM IST = 03:30–04:30 UTC (15‑minute steps, same as hoot jobs).
--
-- Edge function smart-master-sync-scrap:
--   • Loads dealers from get_scrap_dealers_for_sync (scrap_link = on in VDP Logics)
--   • Calls build_smart_final_data_scrap once per scrap dealer (no client_id in body needed)
--
-- Deploy in Supabase SQL Editor:
--   1. Replace __SERVICE_ROLE_KEY__ with your service role key (Dashboard → Settings → API).
--   2. Deploy edge function: supabase functions deploy smart-master-sync-scrap
--   3. Deploy RPC: supabase/rpc/build_smart_final_data_scrap.sql
--   4. Run this entire script once.
--
-- Requires: pg_cron, pg_net (already used by smart-master-sync jobs).

-- Remove previous scrap cron jobs if re-running
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT jobname FROM cron.job WHERE jobname LIKE 'smart-master-sync-scrap%'
  LOOP
    PERFORM cron.unschedule(r.jobname);
  END LOOP;
END $$;

-- 9:00 & 9:15 AM IST  →  03:30 & 03:45 UTC
SELECT cron.schedule(
  'smart-master-sync-scrap',
  '30,45 3 * * *',
  $$
  SELECT net.http_post(
    url := 'https://rllwmeqingvuohyctddg.supabase.co/functions/v1/smart-master-sync-scrap',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer __SERVICE_ROLE_KEY__'
    ),
    body := jsonb_build_object('days_back', 5)::jsonb
  ) AS request_id;
  $$
);

-- 9:30, 9:45 & 10:00 AM IST  →  04:00, 04:15 & 04:30 UTC
SELECT cron.schedule(
  'smart-master-sync-scrap-2',
  '0,15,30 4 * * *',
  $$
  SELECT net.http_post(
    url := 'https://rllwmeqingvuohyctddg.supabase.co/functions/v1/smart-master-sync-scrap',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer __SERVICE_ROLE_KEY__'
    ),
    body := jsonb_build_object('days_back', 5)::jsonb
  ) AS request_id;
  $$
);

-- Verify
SELECT jobid, jobname, schedule, active FROM cron.job
WHERE jobname LIKE 'smart-master-sync-scrap%'
ORDER BY jobname;
