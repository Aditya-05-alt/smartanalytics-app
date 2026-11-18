-- VDP Analysis daily sync — last 5 settled days only (inventory + unit views + channel pages).
-- One-time month backfill: POST { "month":"2026-11", "fill_month": true }.
-- Runs after vdp-change-daily-sync (06:20 UTC) so Final / stock sources are warm.
-- Deploy edge: vdp-analysis-daily-sync. Service key is injected when scheduling (not stored in git).

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT jobname FROM cron.job WHERE jobname = 'vdp-analysis-daily-sync'
  LOOP
    PERFORM cron.unschedule(r.jobname);
  END LOOP;
END $$;

SELECT cron.schedule(
  'vdp-analysis-daily-sync',
  '40 6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://rllwmeqingvuohyctddg.supabase.co/functions/v1/vdp-analysis-daily-sync',
    headers := jsonb_build_object(
      'Authorization', 'Bearer __SERVICE_ROLE_KEY__',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
