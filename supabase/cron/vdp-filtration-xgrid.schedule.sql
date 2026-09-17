-- XGRID-only Step 2 (VDP filtration) safety pass.
--
-- Why this exists:
--   smart-ga4-filteration processes dealers in 15 batches under a 145s budget and
--   abandons whatever is left in the batch when the budget runs out. Dealer order is
--   deterministic (ordered by account_name), so the same dealer is dropped every
--   night. XGRiD Campers (client_id 7231326744) has been that dealer since
--   2026-09-11, leaving smart_ga4_page_data.vdp_conditions NULL and its VDP views
--   reading zero on the dashboard.
--
--   The failure is silent: vdp-filtration and vdp-filtration-final both report
--   "succeeded" because their bodies use net.http_post, which is fire-and-forget and
--   never learns whether the edge function actually finished.
--
-- Placement: 02:35 UTC sits after vdp-filtration-final (02:00) and before
-- smart-master-sync-qs (02:50), so the flags are set before Step 3 consumes them.
-- The call is scoped to a single client_id and touches no other dealer.
--
-- Note: this does not address Step 3 routing. XGRID still needs the QS Step 3 path
-- (see PAGE_PATH_QS_CLIENT_IDS / QS_CLIENT_IDS in the smart-master-sync functions),
-- which requires deploying those edge functions.

DO $mig$
DECLARE
  svc_key text;
  fn_url  text := 'https://rllwmeqingvuohyctddg.supabase.co/functions/v1/smart-ga4-filteration';
BEGIN
  -- Reuse the service key already stored on the parent filtration job so the key
  -- is never written into migration source.
  SELECT substring(command from 'svc_key\s+text\s*:=\s*''([^'']+)''')
    INTO svc_key
  FROM cron.job
  WHERE jobname = 'vdp-filtration'
  LIMIT 1;

  IF svc_key IS NULL OR svc_key = '' THEN
    RAISE EXCEPTION 'Could not read service key from existing vdp-filtration cron job';
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'vdp-filtration-xgrid') THEN
    PERFORM cron.unschedule('vdp-filtration-xgrid');
  END IF;

  PERFORM cron.schedule(
    'vdp-filtration-xgrid',
    '35 2 * * *',
    format(
      $job$
      SELECT net.http_post(
        url     := %L,
        headers := jsonb_build_object(
          'Authorization', %L,
          'Content-Type',  'application/json'
        ),
        body    := jsonb_build_object(
          'client_id', '7231326744',
          'days_back', 7
        )
      );
      $job$,
      fn_url,
      'Bearer ' || svc_key
    )
  );
END $mig$;
