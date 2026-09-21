-- Nightly replay of the Logic 2 notebook onto smart_final_data.
--
-- APPLIED 2026-09-17, in this order:
--   1. supabase/migrations/20260917_logic2_notebook_prepare.sql
--   2. supabase/rpc/apply_logic2_notebook_replay.sql
--   3. supabase/rpc/apply_logic2_unknown_cleanup.sql   (records fixes + skips solved)
--   4. supabase/migrations/20260917_logic2_notebook_backfill.sql  (seeds the notebook)
--   5. this file
--
-- Seeded 7,570 fixes across 71 dealers. The first replay repaired 5,741 rows in the
-- 7-day window; a second immediate run repaired 0, confirming it is idempotent. Row
-- count and total views were byte-identical before and after (85,169 rows / 329,708
-- views), which is the guarantee that matters: identity is restored, metrics are not
-- touched.
--
-- Where this sits, in UTC (IST = UTC + 5:30):
--   01:00-01:45  vdp-filtration                Step 2 sets vdp_conditions
--   02:00        vdp-filtration-final          Step 2 late pass
--   02:15-04:45  smart-master-sync             Step 3 (non-QS) rebuild
--   02:35        vdp-filtration-xgrid          XGRID-only Step 2 safety pass
--   02:50        smart-master-sync-qs          Step 3 (QS) rebuild
--   03:00-04:45  smart-master-sync-final       Step 3 late passes
--   05:00-05:45  smart-final-daily-status etc. status checks
--   >>> 09:25    logic2-notebook-replay        THIS JOB — restores recorded fixes
--   09:30        logic2-unknown-cleanup        Logic 2 pass 1, only genuinely new URLs
--   10:00        logic2-unknown-cleanup-2      Logic 2 pass 2
--   10:30        logic2-unknown-cleanup-3      Logic 2 pass 3
--   11:00        logic2-unknown-cleanup-final  Logic 2 pass 4
--   11:05        logic2-unknown-cleanup-status daily email
--
-- 09:25 UTC = 2:55 PM IST. The replay is deliberately part of the same afternoon slot
-- as Logic 2 (3:00-4:30 PM IST) rather than a separate early-morning job, and runs five
-- minutes ahead of Logic 2's first pass. That ordering matters: the notebook is restored
-- before Logic 2 goes looking for leftovers, so Logic 2 only ever sees URLs that are
-- genuinely still unsolved. Reversing the order would still be correct — Logic 2 skips
-- notebook entries by membership, not by what smart_final_data currently holds — but it
-- would leave the table wrong for an extra half hour each day.
--
-- Any time before 04:45 would be pointless: the Step 3 passes running until then delete
-- and rebuild the window, discarding whatever the replay had just written.
--
-- Known trade-off: between the last Step 3 pass (04:45 UTC / 10:15 AM IST) and this job,
-- the dashboard still shows Unknown/Other for the affected URLs. Moving the replay to
-- ~05:05 UTC would close that gap; it was kept in the afternoon slot so the whole
-- Logic 2 system stays in one predictable window.
--
-- The 7-day range matches Step 3's rolling window; older dates are never rebuilt, so
-- their fixes were never wiped and need no replay.

DO $mig$
DECLARE
  svc_key text;
BEGIN
  -- Verify the pieces exist before scheduling anything against them.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'apply_logic2_notebook_replay'
  ) THEN
    RAISE EXCEPTION 'apply_logic2_notebook_replay does not exist — apply supabase/rpc/apply_logic2_notebook_replay.sql first';
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'logic2-notebook-replay') THEN
    PERFORM cron.unschedule('logic2-notebook-replay');
  END IF;

  -- Called directly rather than through an edge function: the replay is a single
  -- indexed UPDATE with no external calls, so there is nothing an HTTP hop adds.
  -- It also avoids the fire-and-forget net.http_post trap that let XGRID's Step 2
  -- report success for six days while doing nothing.
  PERFORM cron.schedule(
    'logic2-notebook-replay',
    '25 9 * * *',
    $job$
    SELECT public.apply_logic2_notebook_replay(
      NULL,
      CURRENT_DATE - 7,
      CURRENT_DATE
    );
    $job$
  );
END $mig$;

-- Verify after applying:
--
--   SELECT jobname, schedule, active FROM cron.job
--   WHERE jobname = 'logic2-notebook-replay';
--
-- And the morning after, confirm it actually did something:
--
--   SELECT j.jobname, d.status, d.start_time, d.return_message
--   FROM cron.job_run_details d JOIN cron.job j ON j.jobid = d.jobid
--   WHERE j.jobname = 'logic2-notebook-replay'
--   ORDER BY d.start_time DESC LIMIT 5;
