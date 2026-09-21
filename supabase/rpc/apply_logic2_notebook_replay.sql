-- Replay durable VDP Logic 2 fixes from the notebook onto smart_final_data.
-- APPLIED 2026-09-17. Scheduled daily at 09:25 UTC (2:55 PM IST) by
-- supabase/cron/logic2-notebook-replay.schedule.sql.
--
-- Runs after Step 3 has finished rebuilding its window. Cheap by design: a pure
-- indexed join on (client_id, page_path) with no regex evaluation and no catalog
-- lookups, unlike apply_logic2_unknown_cleanup.
--
-- Two rules this function must never break:
--
--   1. LAST RESORT, NOT OVERRIDE. A field is only filled when smart_final_data has
--      nothing usable there (NULL, blank, 'unknown' or 'other'). If Step 3 resolved
--      a value from the live inventory feed, that value wins — the notebook never
--      overwrites fresher truth.
--
--   2. METRICS ARE NEVER TOUCHED. views, sessions, total_users, new_users and
--      report_date belong to Step 3 alone. The notebook only supplies identity.
--
-- The trailing WHERE guard also keeps this from rewriting rows that already look
-- correct, which matters on a table carrying 11 GB of indexes: every needless UPDATE
-- would leave a dead row version behind and inflate the disk further.

CREATE OR REPLACE FUNCTION public.apply_logic2_notebook_replay(
  p_client_id text DEFAULT NULL,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id text := NULLIF(btrim(p_client_id), '');
  v_rows bigint := 0;
  v_notebook bigint := 0;
BEGIN
  IF p_from IS NULL OR p_to IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'p_from_and_p_to_required');
  END IF;

  WITH applied AS (
    UPDATE public.smart_final_data f
    SET
      vdp_conditions = TRUE,

      inv_url = COALESCE(NULLIF(btrim(f.inv_url), ''), n.inv_url),

      inv_make = CASE
        WHEN NULLIF(btrim(f.inv_make), '') IS NULL
          OR lower(btrim(f.inv_make)) IN ('unknown', 'other')
        THEN COALESCE(n.inv_make, f.inv_make)
        ELSE f.inv_make
      END,

      inv_model = CASE
        WHEN NULLIF(btrim(f.inv_model), '') IS NULL
          OR lower(btrim(f.inv_model)) IN ('unknown', 'other')
        THEN COALESCE(n.inv_model, f.inv_model)
        ELSE f.inv_model
      END,

      inv_year = CASE
        WHEN NULLIF(btrim(f.inv_year), '') IS NULL OR btrim(f.inv_year) = '0'
        THEN COALESCE(n.inv_year, f.inv_year)
        ELSE f.inv_year
      END,

      inv_condition = CASE
        WHEN NULLIF(btrim(f.inv_condition), '') IS NULL
          OR lower(btrim(f.inv_condition)) IN ('unknown', 'other')
        THEN COALESCE(n.inv_condition, f.inv_condition)
        ELSE f.inv_condition
      END,

      inv_type = CASE
        WHEN NULLIF(btrim(f.inv_type), '') IS NULL
          OR lower(btrim(f.inv_type)) IN ('unknown', 'other')
        THEN COALESCE(n.inv_type, f.inv_type)
        ELSE f.inv_type
      END,

      inv_custom_type = CASE
        WHEN NULLIF(btrim(f.inv_custom_type), '') IS NULL
          OR lower(btrim(f.inv_custom_type)) IN ('unknown', 'other')
        THEN COALESCE(n.inv_custom_type, n.inv_type, f.inv_custom_type)
        ELSE f.inv_custom_type
      END,

      inv_stock_number = COALESCE(
        NULLIF(btrim(f.inv_stock_number), ''),
        n.inv_stock_number
      )

    FROM public.smart_unknown_vdp_links n
    WHERE n.client_id = f.client_id
      AND n.page_path = f.page_path
      AND n.status IN ('matched', 'applied')
      AND NULLIF(btrim(n.inv_url), '') IS NOT NULL
      AND f.report_date BETWEEN p_from AND p_to
      AND (v_id IS NULL OR f.client_id = v_id)
      -- Only touch rows that still need help. Skips rows Step 3 already resolved,
      -- which avoids pointless writes and the table bloat they cause.
      AND (
        f.vdp_conditions IS DISTINCT FROM TRUE
        OR NULLIF(btrim(f.inv_url), '') IS NULL
        OR NULLIF(btrim(f.inv_make), '') IS NULL
        OR lower(btrim(f.inv_make)) IN ('unknown', 'other')
        OR NULLIF(btrim(f.inv_model), '') IS NULL
        OR NULLIF(btrim(f.inv_type), '') IS NULL
        OR lower(btrim(f.inv_type)) IN ('unknown', 'other')
      )
    RETURNING n.id AS notebook_id
  ),
  bumped AS (
    UPDATE public.smart_unknown_vdp_links n
    SET status = 'applied',
        applied_at = now(),
        replay_count = n.replay_count + 1,
        updated_at = now()
    WHERE n.id IN (SELECT notebook_id FROM applied)
    RETURNING n.id
  )
  SELECT
    (SELECT COUNT(*) FROM applied),
    (SELECT COUNT(*) FROM bumped)
  INTO v_rows, v_notebook;

  RETURN jsonb_build_object(
    'ok', true,
    'client_id', COALESCE(v_id, 'ALL'),
    'from', p_from,
    'to', p_to,
    'final_rows_repaired', v_rows,
    'notebook_entries_used', v_notebook,
    'notebook_replayable', (
      SELECT COUNT(*) FROM public.smart_unknown_vdp_links
      WHERE status IN ('matched', 'applied')
        AND NULLIF(btrim(inv_url), '') IS NOT NULL
        AND (v_id IS NULL OR client_id = v_id)
    )
  );
END;
$$;

COMMENT ON FUNCTION public.apply_logic2_notebook_replay(text, date, date) IS
  'Reapplies stored VDP Logic 2 fixes from smart_unknown_vdp_links onto smart_final_data after a Step 3 rebuild. Fills only missing/unknown identity fields, never overwrites values Step 3 resolved, and never touches metrics.';

REVOKE ALL ON FUNCTION public.apply_logic2_notebook_replay(text, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_logic2_notebook_replay(text, date, date)
  TO service_role;
