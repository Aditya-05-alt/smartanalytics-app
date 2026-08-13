-- Daily scrap-dealer transfer status (all scrap_link = on dealers).
-- One row per dealer per Asia/Kolkata calendar day.
-- Used by Edge Function scrap-dealers-daily-status + cron.
-- Deploy in Supabase SQL editor.

CREATE TABLE IF NOT EXISTS public.smart_scrap_daily_status (
  report_date            date NOT NULL,
  ga4_customer_id        text NOT NULL,
  dealer_name            text NOT NULL,
  transmitted            boolean NOT NULL DEFAULT false,
  live_units             bigint NOT NULL DEFAULT 0,
  transferred_units      bigint NOT NULL DEFAULT 0,
  daily_snapshot_units   bigint NOT NULL DEFAULT 0,
  day_complete_units     integer NOT NULL DEFAULT 0,
  last_seen              timestamptz NULL,
  completed_at           timestamptz NULL,
  checked_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT smart_scrap_daily_status_pkey
    PRIMARY KEY (report_date, ga4_customer_id)
);

CREATE INDEX IF NOT EXISTS idx_scrap_daily_status_date
  ON public.smart_scrap_daily_status (report_date DESC);

CREATE INDEX IF NOT EXISTS idx_scrap_daily_status_missing
  ON public.smart_scrap_daily_status (report_date)
  WHERE transmitted IS FALSE;

COMMENT ON TABLE public.smart_scrap_daily_status IS
  'Daily per-dealer scrap transfer check. Source: get_scrap_dealers_for_sync + inventory/day-complete.';

-- ── Read current snapshot (does not write) ─────────────────────────────────

DROP FUNCTION IF EXISTS public.get_scrap_dealers_daily_status(date);

CREATE OR REPLACE FUNCTION public.get_scrap_dealers_daily_status(
  p_report_date date DEFAULT NULL
)
RETURNS TABLE (
  report_date          date,
  ga4_customer_id      text,
  dealer_name          text,
  transmitted          boolean,
  live_units           bigint,
  transferred_units    bigint,
  daily_snapshot_units bigint,
  day_complete_units   integer,
  last_seen            timestamptz,
  completed_at         timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date date := COALESCE(
    p_report_date,
    (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date
  );
BEGIN
  RETURN QUERY
  WITH dealers AS (
    SELECT
      trim(s.ga4_customer_id) AS ga4_customer_id,
      s.customer_name AS dealer_name
    FROM public.get_scrap_dealers_for_sync(NULL) s
  ),
  inv AS (
    SELECT
      NULLIF(trim(i.customer_id::text), '') AS customer_id,
      NULLIF(trim(i.customer_name), '') AS customer_name,
      COUNT(*)::bigint AS live_units,
      COUNT(*) FILTER (
        WHERE (
          COALESCE(i.last_seen, i.updated_at, i.created_at)
            AT TIME ZONE 'Asia/Kolkata'
        )::date = v_date
      )::bigint AS transferred_units,
      MAX(i.last_seen) AS last_seen
    FROM public.smart_scrap_inventory i
    GROUP BY 1, 2
  ),
  inv_by_dealer AS (
    SELECT
      d.ga4_customer_id,
      COALESCE(SUM(inv.live_units), 0)::bigint AS live_units,
      COALESCE(SUM(inv.transferred_units), 0)::bigint AS transferred_units,
      MAX(inv.last_seen) AS last_seen
    FROM dealers d
    LEFT JOIN inv
      ON inv.customer_id = d.ga4_customer_id
      OR (
        inv.customer_name IS NOT NULL
        AND lower(inv.customer_name) = lower(trim(d.dealer_name))
      )
    GROUP BY d.ga4_customer_id
  ),
  daily AS (
    SELECT
      NULLIF(trim(d.customer_id::text), '') AS customer_id,
      NULLIF(trim(d.customer_name), '') AS customer_name,
      COUNT(*)::bigint AS daily_units
    FROM public.smart_scrap_inventory_daily d
    WHERE d.pull_date = v_date
    GROUP BY 1, 2
  ),
  daily_by_dealer AS (
    SELECT
      d.ga4_customer_id,
      COALESCE(SUM(daily.daily_units), 0)::bigint AS daily_units
    FROM dealers d
    LEFT JOIN daily
      ON daily.customer_id = d.ga4_customer_id
      OR (
        daily.customer_name IS NOT NULL
        AND lower(daily.customer_name) = lower(trim(d.dealer_name))
      )
    GROUP BY d.ga4_customer_id
  ),
  complete AS (
    SELECT
      trim(c.ga4_customer_id) AS ga4_customer_id,
      COALESCE(c.row_count, 0)::integer AS day_complete_units,
      c.completed_at
    FROM public.smart_scrap_day_complete c
    WHERE c.report_date = v_date
  )
  SELECT
    v_date AS report_date,
    d.ga4_customer_id,
    d.dealer_name,
    (
      COALESCE(c.day_complete_units, 0) > 0
      OR COALESCE(i.transferred_units, 0) > 0
      OR COALESCE(dy.daily_units, 0) > 0
    ) AS transmitted,
    COALESCE(i.live_units, 0) AS live_units,
    COALESCE(i.transferred_units, 0) AS transferred_units,
    COALESCE(dy.daily_units, 0) AS daily_snapshot_units,
    COALESCE(c.day_complete_units, 0) AS day_complete_units,
    i.last_seen,
    c.completed_at
  FROM dealers d
  LEFT JOIN inv_by_dealer i ON i.ga4_customer_id = d.ga4_customer_id
  LEFT JOIN daily_by_dealer dy ON dy.ga4_customer_id = d.ga4_customer_id
  LEFT JOIN complete c ON c.ga4_customer_id = d.ga4_customer_id
  ORDER BY d.dealer_name;
END;
$$;

-- ── Write + return (Edge Function calls this) ──────────────────────────────

DROP FUNCTION IF EXISTS public.snapshot_scrap_dealers_daily_status(date);

CREATE OR REPLACE FUNCTION public.snapshot_scrap_dealers_daily_status(
  p_report_date date DEFAULT NULL
)
RETURNS TABLE (
  report_date          date,
  ga4_customer_id      text,
  dealer_name          text,
  transmitted          boolean,
  live_units           bigint,
  transferred_units    bigint,
  daily_snapshot_units bigint,
  day_complete_units   integer,
  last_seen            timestamptz,
  completed_at         timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date date := COALESCE(
    p_report_date,
    (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date
  );
BEGIN
  INSERT INTO public.smart_scrap_daily_status (
    report_date,
    ga4_customer_id,
    dealer_name,
    transmitted,
    live_units,
    transferred_units,
    daily_snapshot_units,
    day_complete_units,
    last_seen,
    completed_at,
    checked_at
  )
  SELECT
    s.report_date,
    s.ga4_customer_id,
    s.dealer_name,
    s.transmitted,
    s.live_units,
    s.transferred_units,
    s.daily_snapshot_units,
    s.day_complete_units,
    s.last_seen,
    s.completed_at,
    now()
  FROM public.get_scrap_dealers_daily_status(v_date) s
  ON CONFLICT (report_date, ga4_customer_id) DO UPDATE SET
    dealer_name            = EXCLUDED.dealer_name,
    transmitted            = EXCLUDED.transmitted,
    live_units             = EXCLUDED.live_units,
    transferred_units      = EXCLUDED.transferred_units,
    daily_snapshot_units   = EXCLUDED.daily_snapshot_units,
    day_complete_units     = EXCLUDED.day_complete_units,
    last_seen              = EXCLUDED.last_seen,
    completed_at           = EXCLUDED.completed_at,
    checked_at             = now();

  RETURN QUERY
  SELECT
    t.report_date,
    t.ga4_customer_id,
    t.dealer_name,
    t.transmitted,
    t.live_units,
    t.transferred_units,
    t.daily_snapshot_units,
    t.day_complete_units,
    t.last_seen,
    t.completed_at
  FROM public.smart_scrap_daily_status t
  WHERE t.report_date = v_date
  ORDER BY t.dealer_name;
END;
$$;

REVOKE ALL ON FUNCTION public.get_scrap_dealers_daily_status(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.snapshot_scrap_dealers_daily_status(date) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_scrap_dealers_daily_status(date)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.snapshot_scrap_dealers_daily_status(date)
  TO service_role;
