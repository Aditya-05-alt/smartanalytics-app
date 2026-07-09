-- Daily inventory snapshots (hoot + scrap) — INSERT only on (pull_date, sk).
-- ON CONFLICT DO NOTHING (no upsert). Safe to schedule via cron / edge function.
--
-- Deploy in Supabase SQL Editor (after smart_hoot_inventory_daily + smart_scrap_inventory_daily tables exist).
--
-- Manual:
--   SELECT public.run_daily_inventory_snapshot(CURRENT_DATE);
--   SELECT public.snapshot_all_inventory_daily(CURRENT_DATE);
--
-- Edge: POST /functions/v1/inventory-daily-snapshot  body: { "pull_date": "2026-07-09" }

DROP FUNCTION IF EXISTS public.run_daily_inventory_snapshot(date, boolean);
DROP FUNCTION IF EXISTS public.snapshot_all_inventory_daily(date);
DROP FUNCTION IF EXISTS public.snapshot_scrap_inventory_daily(date);
DROP FUNCTION IF EXISTS public.snapshot_hoot_inventory_daily(date);

-- ── Hoot: insert-only snapshot ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.snapshot_hoot_inventory_daily(
  p_pull_date date DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  snapshot_date date,
  inserted      bigint,
  skipped       bigint,
  source_rows   bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_source   bigint;
  v_before   bigint;
  v_after    bigint;
  v_inserted bigint;
BEGIN
  IF p_pull_date IS NULL THEN
    RAISE EXCEPTION 'p_pull_date is required';
  END IF;

  SELECT COUNT(*)::bigint INTO v_source FROM public.smart_hoot_inventory;

  SELECT COUNT(*)::bigint INTO v_before
  FROM public.smart_hoot_inventory_daily
  WHERE pull_date = p_pull_date;

  INSERT INTO public.smart_hoot_inventory_daily_log AS l (pull_date, started_at, source_rows)
  VALUES (p_pull_date, now(), v_source)
  ON CONFLICT ON CONSTRAINT smart_hoot_inventory_daily_log_pkey DO UPDATE
    SET started_at = now(),
        finished_at = NULL,
        source_rows = EXCLUDED.source_rows,
        note = 'insert-only run';

  INSERT INTO public.smart_hoot_inventory_daily (
    pull_date,
    sk,
    vin,
    url,
    advertiser,
    make,
    model,
    year,
    price,
    condition,
    first_seen,
    last_seen,
    raw_data,
    customer_name,
    location,
    msrp,
    type_,
    trim,
    stock_number,
    website_platform,
    snapshotted_at
  )
  SELECT
    p_pull_date,
    i.sk,
    i.vin,
    i.url,
    i.advertiser,
    i.make,
    i.model,
    i.year,
    i.price,
    i.condition,
    i.first_seen,
    i.last_seen,
    i.raw_data,
    i.customer_name,
    i.location,
    i.msrp,
    i.type_,
    i.trim,
    i.stock_number,
    i.website_platform,
    now()
  FROM public.smart_hoot_inventory i
  ON CONFLICT ON CONSTRAINT smart_hoot_inventory_daily_pkey DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  SELECT COUNT(*)::bigint INTO v_after
  FROM public.smart_hoot_inventory_daily
  WHERE pull_date = p_pull_date;

  UPDATE public.smart_hoot_inventory_daily_log AS l
  SET finished_at = now(),
      row_count = v_after,
      note = 'ok-insert-only'
  WHERE l.pull_date = p_pull_date;

  RETURN QUERY
  SELECT
    p_pull_date,
    v_inserted,
    GREATEST(v_after - v_before - v_inserted, 0::bigint),
    v_source;
END;
$$;

COMMENT ON FUNCTION public.snapshot_hoot_inventory_daily(date) IS
  'Insert-only copy of smart_hoot_inventory → smart_hoot_inventory_daily for pull_date. Skips existing (pull_date, sk).';

-- ── Scrap: insert-only snapshot ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.snapshot_scrap_inventory_daily(
  p_pull_date date DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  snapshot_date date,
  inserted      bigint,
  skipped       bigint,
  source_rows   bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_source   bigint;
  v_before   bigint;
  v_after    bigint;
  v_inserted bigint;
BEGIN
  IF p_pull_date IS NULL THEN
    RAISE EXCEPTION 'p_pull_date is required';
  END IF;

  SELECT COUNT(*)::bigint INTO v_source FROM public.smart_scrap_inventory;

  SELECT COUNT(*)::bigint INTO v_before
  FROM public.smart_scrap_inventory_daily
  WHERE pull_date = p_pull_date;

  INSERT INTO public.smart_scrap_inventory_daily_log AS l (pull_date, started_at, source_rows)
  VALUES (p_pull_date, now(), v_source)
  ON CONFLICT ON CONSTRAINT smart_scrap_inventory_daily_log_pkey DO UPDATE
    SET started_at = now(),
        finished_at = NULL,
        source_rows = EXCLUDED.source_rows,
        note = 'insert-only run';

  INSERT INTO public.smart_scrap_inventory_daily (
    pull_date,
    sk,
    vin,
    url,
    advertiser,
    customer_id,
    make,
    model,
    year,
    price,
    condition,
    first_seen,
    last_seen,
    raw_data,
    customer_name,
    location,
    msrp,
    type_,
    trim,
    stock_number,
    website_platform,
    snapshotted_at
  )
  SELECT
    p_pull_date,
    i.sk,
    i.vin,
    i.url,
    i.advertiser,
    NULLIF(TRIM(i.customer_id::text), ''),
    i.make,
    i.model,
    i.year,
    i.price,
    i.condition,
    i.first_seen,
    i.last_seen,
    i.raw_data,
    i.customer_name,
    i.location,
    i.msrp,
    i.type_,
    i.trim,
    i.stock_number,
    i.website_platform,
    now()
  FROM public.smart_scrap_inventory i
  ON CONFLICT ON CONSTRAINT smart_scrap_inventory_daily_pkey DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  SELECT COUNT(*)::bigint INTO v_after
  FROM public.smart_scrap_inventory_daily
  WHERE pull_date = p_pull_date;

  UPDATE public.smart_scrap_inventory_daily_log AS l
  SET finished_at = now(),
      row_count = v_after,
      note = 'ok-insert-only'
  WHERE l.pull_date = p_pull_date;

  RETURN QUERY
  SELECT
    p_pull_date,
    v_inserted,
    GREATEST(v_after - v_before - v_inserted, 0::bigint),
    v_source;
END;
$$;

COMMENT ON FUNCTION public.snapshot_scrap_inventory_daily(date) IS
  'Insert-only copy of smart_scrap_inventory → smart_scrap_inventory_daily for pull_date. Skips existing (pull_date, sk).';

-- ── Both sources ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.snapshot_all_inventory_daily(
  p_pull_date date DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  source        text,
  snapshot_date date,
  inserted      bigint,
  skipped       bigint,
  source_rows   bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    'hoot'::text,
    h.snapshot_date,
    h.inserted,
    h.skipped,
    h.source_rows
  FROM public.snapshot_hoot_inventory_daily(p_pull_date) AS h;

  RETURN QUERY
  SELECT
    'scrap'::text,
    s.snapshot_date,
    s.inserted,
    s.skipped,
    s.source_rows
  FROM public.snapshot_scrap_inventory_daily(p_pull_date) AS s;
END;
$$;

-- ── Cron / edge entrypoint ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.run_daily_inventory_snapshot(
  p_pull_date date DEFAULT CURRENT_DATE,
  p_skip_if_complete boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pull_date date := COALESCE(p_pull_date, CURRENT_DATE);
  v_hoot_done boolean;
  v_scrap_done boolean;
  v_hoot_row record;
  v_scrap_row record;
BEGIN
  IF v_pull_date IS NULL THEN
    RAISE EXCEPTION 'p_pull_date is required';
  END IF;

  IF p_skip_if_complete THEN
    SELECT
      EXISTS (
        SELECT 1
        FROM public.smart_hoot_inventory_daily_log l
        WHERE l.pull_date = v_pull_date
          AND l.finished_at IS NOT NULL
          AND l.note = 'ok-insert-only'
      ),
      EXISTS (
        SELECT 1
        FROM public.smart_scrap_inventory_daily_log l
        WHERE l.pull_date = v_pull_date
          AND l.finished_at IS NOT NULL
          AND l.note = 'ok-insert-only'
      )
    INTO v_hoot_done, v_scrap_done;

    IF v_hoot_done AND v_scrap_done THEN
      RETURN jsonb_build_object(
        'success', true,
        'skippedRun', true,
        'pullDate', v_pull_date,
        'message', 'Snapshot already completed for this pull_date (insert-only; no re-run).',
        'hoot', jsonb_build_object(
          'dailyRows', (SELECT COUNT(*) FROM public.smart_hoot_inventory_daily WHERE pull_date = v_pull_date)
        ),
        'scrap', jsonb_build_object(
          'dailyRows', (SELECT COUNT(*) FROM public.smart_scrap_inventory_daily WHERE pull_date = v_pull_date)
        )
      );
    END IF;
  END IF;

  SELECT * INTO v_hoot_row
  FROM public.snapshot_hoot_inventory_daily(v_pull_date)
  LIMIT 1;

  SELECT * INTO v_scrap_row
  FROM public.snapshot_scrap_inventory_daily(v_pull_date)
  LIMIT 1;

  RETURN jsonb_build_object(
    'success', true,
    'skippedRun', false,
    'pullDate', v_pull_date,
    'hoot', jsonb_build_object(
      'inserted', COALESCE(v_hoot_row.inserted, 0),
      'skipped', COALESCE(v_hoot_row.skipped, 0),
      'sourceRows', COALESCE(v_hoot_row.source_rows, 0),
      'dailyRows', (SELECT COUNT(*) FROM public.smart_hoot_inventory_daily WHERE pull_date = v_pull_date)
    ),
    'scrap', jsonb_build_object(
      'inserted', COALESCE(v_scrap_row.inserted, 0),
      'skipped', COALESCE(v_scrap_row.skipped, 0),
      'sourceRows', COALESCE(v_scrap_row.source_rows, 0),
      'dailyRows', (SELECT COUNT(*) FROM public.smart_scrap_inventory_daily WHERE pull_date = v_pull_date)
    )
  );
END;
$$;

COMMENT ON FUNCTION public.run_daily_inventory_snapshot(date, boolean) IS
  'Insert-only daily snapshot for hoot + scrap inventory. Used by inventory-daily-snapshot edge function / pg_cron.';

GRANT EXECUTE ON FUNCTION public.snapshot_hoot_inventory_daily(date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.snapshot_scrap_inventory_daily(date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.snapshot_all_inventory_daily(date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.run_daily_inventory_snapshot(date, boolean) TO anon, authenticated, service_role;
