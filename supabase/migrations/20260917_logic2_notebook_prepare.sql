-- Notebook prep for durable VDP Logic 2 fixes. APPLIED 2026-09-17.
--
-- Problem being solved
--   Step 3 (build_smart_final_data*) deletes and rebuilds its rolling window every
--   night, discarding everything apply_logic2_unknown_cleanup resolved the previous
--   morning. Logic 2 then repeats the identical regex + catalog work at 09:30 UTC.
--   Three consequences:
--     1. The dashboard shows Unknown/Other for ~7 hours every morning (02:15-09:30).
--     2. Logic 2 re-solves URLs it already solved, every single day.
--     3. If a Logic 2 run is ever missed, the fix disappears with no record that it
--        ever existed — the same silent-loss pattern that cost XGRID six days.
--
-- The notebook
--   smart_unknown_vdp_links becomes the durable record of a solved URL, keyed on
--   (client_id, page_path) and independent of report_date. It stores only a URL's
--   identity (the inv_* fields) and never views/sessions/users, so Step 3 remains
--   the sole owner of all metrics. A page whose traffic doubles still reports
--   doubled traffic; it just keeps its correct vehicle details.
--
-- Safety
--   This table is dormant. Nothing in the application and no database function
--   references it (verified 2026-09-17), and all 983 existing rows come from a
--   single one-off load on 2026-09-02.

BEGIN;

-- apply_logic2_unknown_cleanup also sets inv_custom_type, so the notebook needs it
-- in order to replay a fix with full fidelity.
ALTER TABLE public.smart_unknown_vdp_links
  ADD COLUMN IF NOT EXISTS inv_custom_type text NULL;

-- Provenance, so any replayed value can be traced to whatever produced it.
ALTER TABLE public.smart_unknown_vdp_links
  ADD COLUMN IF NOT EXISTS fix_source text NULL;

ALTER TABLE public.smart_unknown_vdp_links
  ADD COLUMN IF NOT EXISTS replay_count integer NOT NULL DEFAULT 0;

-- Retire the stale 2026-09-02 experiment instead of replaying 43 rows of unverified
-- state onto production. The backfill migration repopulates authoritatively from
-- smart_final_data. 'skipped' is already permitted by the status CHECK constraint.
UPDATE public.smart_unknown_vdp_links
SET status = 'skipped',
    fix_source = 'pre-notebook-experiment',
    updated_at = now()
WHERE fix_source IS NULL;

-- One notebook entry per URL per dealer. Confirmed duplicate-free before adding the
-- unique index: 983 rows, 983 distinct (client_id, page_path) pairs.
DROP INDEX IF EXISTS public.idx_smart_unknown_vdp_links_client_path;

CREATE UNIQUE INDEX IF NOT EXISTS uq_smart_unknown_vdp_links_client_path
  ON public.smart_unknown_vdp_links (client_id, page_path);

-- The replay only ever reads solved entries.
CREATE INDEX IF NOT EXISTS idx_smart_unknown_vdp_links_replayable
  ON public.smart_unknown_vdp_links (client_id)
  WHERE status IN ('matched', 'applied');

COMMENT ON TABLE public.smart_unknown_vdp_links IS
  'Notebook of VDP Logic 2 fixes: one row per (client_id, page_path), independent of report_date. Stores only URL identity (inv_*) so Step 3 keeps owning views/sessions. Replayed onto smart_final_data by apply_logic2_notebook_replay after each Step 3 rebuild.';

COMMENT ON COLUMN public.smart_unknown_vdp_links.status IS
  'pending = seen as unknown but unsolved (never replayed). matched = Logic 2 solved it. applied = replayed onto smart_final_data at least once. skipped = deliberately excluded.';

COMMENT ON COLUMN public.smart_unknown_vdp_links.fix_source IS
  'What produced the stored answer: logic2, backfill, or manual.';

COMMENT ON COLUMN public.smart_unknown_vdp_links.replay_count IS
  'How many times this fix has been replayed onto smart_final_data. Useful for spotting entries that are replayed forever because Step 3 can never resolve them.';

COMMIT;
