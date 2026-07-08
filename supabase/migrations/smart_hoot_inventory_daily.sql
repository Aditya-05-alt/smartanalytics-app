-- smart_hoot_inventory_daily — daily snapshot of smart_hoot_inventory (hoot only).
-- Same columns as smart_hoot_inventory + pull_date (the calendar day the snapshot was taken).
--
-- Deploy (Supabase SQL Editor):
--   1. Run this ENTIRE file (drops old objects, then recreates).
--   2. Snapshot today:  SELECT * FROM public.snapshot_hoot_inventory_daily(CURRENT_DATE);
--   3. Schedule daily after Hoot sync (pg_cron / pipeline / manual).
--
-- Grain: one row per (sk, pull_date).

-- ── 0. DROP (safe re-run — removes prior deploy) ─────────────────────────────

DROP FUNCTION IF EXISTS public.backfill_hoot_inventory_daily(date, date);
DROP FUNCTION IF EXISTS public.snapshot_hoot_inventory_daily(date);

DROP TABLE IF EXISTS public.smart_hoot_inventory_daily CASCADE;
DROP TABLE IF EXISTS public.smart_hoot_inventory_daily_log CASCADE;

-- ── 1. Daily snapshot table ───────────────────────────────────────────────────

CREATE TABLE public.smart_hoot_inventory_daily (
  pull_date          date NOT NULL,
  sk                 text NOT NULL,
  vin                text NULL,
  url                text NULL,
  advertiser         text NULL,
  make               text NULL,
  model              text NULL,
  year               text NULL,
  price              numeric NULL,
  condition          text NULL,
  first_seen         timestamptz NULL,
  last_seen          timestamptz NULL,
  raw_data           jsonb NULL,
  customer_name      text NULL,
  location           text NULL,
  msrp               numeric NULL,
  type_              text NULL,
  trim               text NULL,
  stock_number       text NULL,
  website_platform   text NULL,
  snapshotted_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT smart_hoot_inventory_daily_pkey PRIMARY KEY (pull_date, sk)
);

COMMENT ON TABLE public.smart_hoot_inventory_daily IS
  'Daily point-in-time copy of smart_hoot_inventory. pull_date = the business day captured.';

COMMENT ON COLUMN public.smart_hoot_inventory_daily.pull_date IS
  'Calendar date this row was pulled from smart_hoot_inventory (not first_seen / last_seen).';

-- ── 2. Indexes ────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_hoot_inv_daily_pull_date
  ON public.smart_hoot_inventory_daily (pull_date DESC);

CREATE INDEX IF NOT EXISTS idx_hoot_inv_daily_customer_pull
  ON public.smart_hoot_inventory_daily (customer_name, pull_date DESC);

CREATE INDEX IF NOT EXISTS idx_hoot_inv_daily_customer_name_pull
  ON public.smart_hoot_inventory_daily (pull_date, customer_name);

CREATE INDEX IF NOT EXISTS idx_hoot_inv_daily_location_pull
  ON public.smart_hoot_inventory_daily (pull_date, location)
  WHERE location IS NOT NULL AND TRIM(location) <> '';

-- ── 3. Optional pull log (one row per pull_date run) ────────────────────────

CREATE TABLE public.smart_hoot_inventory_daily_log (
  pull_date       date PRIMARY KEY,
  row_count       bigint NOT NULL DEFAULT 0,
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz NULL,
  source_rows     bigint NULL,
  note            text NULL
);

COMMENT ON TABLE public.smart_hoot_inventory_daily_log IS
  'Audit log for snapshot_hoot_inventory_daily runs.';

-- ── 4. Snapshot function: smart_hoot_inventory → daily table ────────────────

CREATE OR REPLACE FUNCTION public.snapshot_hoot_inventory_daily(
  p_pull_date date DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  snapshot_date date,
  inserted      bigint,
  updated       bigint,
  source_rows   bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_source bigint;
  v_inserted bigint;
  v_updated bigint;
BEGIN
  IF p_pull_date IS NULL THEN
    RAISE EXCEPTION 'p_pull_date is required';
  END IF;

  SELECT COUNT(*)::bigint INTO v_source
  FROM public.smart_hoot_inventory;

  INSERT INTO public.smart_hoot_inventory_daily_log AS l (pull_date, started_at, source_rows)
  VALUES (p_pull_date, now(), v_source)
  ON CONFLICT ON CONSTRAINT smart_hoot_inventory_daily_log_pkey DO UPDATE
    SET started_at = now(),
        finished_at = NULL,
        source_rows = EXCLUDED.source_rows,
        note = 're-run';

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
  ON CONFLICT ON CONSTRAINT smart_hoot_inventory_daily_pkey DO UPDATE SET
    vin              = EXCLUDED.vin,
    url              = EXCLUDED.url,
    advertiser       = EXCLUDED.advertiser,
    make             = EXCLUDED.make,
    model            = EXCLUDED.model,
    year             = EXCLUDED.year,
    price            = EXCLUDED.price,
    condition        = EXCLUDED.condition,
    first_seen       = EXCLUDED.first_seen,
    last_seen        = EXCLUDED.last_seen,
    raw_data         = EXCLUDED.raw_data,
    customer_name    = EXCLUDED.customer_name,
    location         = EXCLUDED.location,
    msrp             = EXCLUDED.msrp,
    type_            = EXCLUDED.type_,
    trim             = EXCLUDED.trim,
    stock_number     = EXCLUDED.stock_number,
    website_platform = EXCLUDED.website_platform,
    snapshotted_at   = now();

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  v_updated := 0;

  UPDATE public.smart_hoot_inventory_daily_log AS l
  SET finished_at = now(),
      row_count = v_inserted,
      note = 'ok'
  WHERE l.pull_date = p_pull_date;

  RETURN QUERY
  SELECT p_pull_date, v_inserted, v_updated, v_source;
END;
$$;

COMMENT ON FUNCTION public.snapshot_hoot_inventory_daily(date) IS
  'Copy all rows from smart_hoot_inventory into smart_hoot_inventory_daily for p_pull_date. Safe to re-run same day (upsert).';

-- ── 5. Backfill helper (date range, inclusive) ──────────────────────────────

CREATE OR REPLACE FUNCTION public.backfill_hoot_inventory_daily(
  p_from date,
  p_to   date DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  snapshot_date date,
  inserted      bigint,
  updated       bigint,
  source_rows   bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  d date;
BEGIN
  IF p_from IS NULL OR p_to IS NULL THEN
    RAISE EXCEPTION 'p_from and p_to are required';
  END IF;
  IF p_from > p_to THEN
    RAISE EXCEPTION 'p_from (%) must be <= p_to (%)', p_from, p_to;
  END IF;

  -- WARNING: uses TODAY''s smart_hoot_inventory for every date in the range.
  -- Use only for bootstrapping when you do not yet have true historic pulls.
  d := p_from;
  WHILE d <= p_to LOOP
    RETURN QUERY
    SELECT s.snapshot_date, s.inserted, s.updated, s.source_rows
    FROM public.snapshot_hoot_inventory_daily(d) AS s;
    d := d + 1;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.backfill_hoot_inventory_daily(date, date) IS
  'Bootstrap: snapshot current smart_hoot_inventory for each day from p_from through p_to. Not true history unless live table still holds that day.';

-- ── 6. Grants ─────────────────────────────────────────────────────────────────

GRANT SELECT ON public.smart_hoot_inventory_daily TO anon, authenticated, service_role;
GRANT SELECT ON public.smart_hoot_inventory_daily_log TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.snapshot_hoot_inventory_daily(date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.backfill_hoot_inventory_daily(date, date) TO anon, authenticated, service_role;

-- ── 7. Quick verification queries (run manually after deploy) ─────────────────
--
-- Snapshot today:
--   SELECT * FROM public.snapshot_hoot_inventory_daily(CURRENT_DATE);
--
-- Row counts by day:
--   SELECT pull_date, COUNT(*) AS units
--   FROM public.smart_hoot_inventory_daily
--   GROUP BY pull_date
--   ORDER BY pull_date DESC;
--
-- Compare live vs today snapshot for one dealer:
--   SELECT 'live' AS src, COUNT(*) FROM public.smart_hoot_inventory
--     WHERE customer_name = 'Bob Rohrman Toyota'
--   UNION ALL
--   SELECT 'daily', COUNT(*) FROM public.smart_hoot_inventory_daily
--     WHERE customer_name = 'Bob Rohrman Toyota' AND pull_date = CURRENT_DATE;
