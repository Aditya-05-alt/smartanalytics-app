-- VDP Change daily sync — last 5 settled days (VDP + stock) + MTD traffic periods.
-- One-time month backfill: POST { "month":"2026-11", "fill_month": true }.
-- Runs after event-tracking-vdp-refresh (06:05 / 06:10 UTC) so Final VDP sources are warm.
-- Deploy edge: vdp-change-daily-sync. Service key is injected when scheduling (not stored in git).

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT jobname FROM cron.job WHERE jobname = 'vdp-change-daily-sync'
  LOOP
    PERFORM cron.unschedule(r.jobname);
  END LOOP;
END $$;

SELECT cron.schedule(
  'vdp-change-daily-sync',
  '20 6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://rllwmeqingvuohyctddg.supabase.co/functions/v1/vdp-change-daily-sync',
    headers := jsonb_build_object(
      'Authorization', 'Bearer __SERVICE_ROLE_KEY__',
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('month', to_char((current_date AT TIME ZONE 'utc'), 'YYYY-MM'))::jsonb
  ) AS request_id;
  $$
);
