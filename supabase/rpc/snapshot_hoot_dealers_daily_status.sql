-- Daily hoot-dealer transfer status (all active dealers with hoot_url).
-- Counts from smart_hoot_inventory using first_seen / last_seen only (no updated_at).
-- Deploy in Supabase SQL editor.

CREATE TABLE IF NOT EXISTS public.smart_hoot_daily_status (
  report_date            date NOT NULL,
  ga4_customer_id        text NOT NULL,
  dealer_name            text NOT NULL,
  transmitted            boolean NOT NULL DEFAULT false,
  live_units             bigint NOT NULL DEFAULT 0,
  transferred_units      bigint NOT NULL DEFAULT 0,
  first_seen_today       bigint NOT NULL DEFAULT 0,
  last_seen              timestamptz NULL,
  checked_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT smart_hoot_daily_status_pkey
    PRIMARY KEY (report_date, ga4_customer_id)
);

CREATE INDEX IF NOT EXISTS idx_hoot_daily_status_date
  ON public.smart_hoot_daily_status (report_date DESC);

CREATE INDEX IF NOT EXISTS idx_hoot_daily_status_missing
  ON public.smart_hoot_daily_status (report_date)
  WHERE transmitted IS FALSE;

COMMENT ON TABLE public.smart_hoot_daily_status IS
  'Daily per-dealer hoot transfer check from smart_hoot_inventory (last_seen / first_seen IST).';

DROP FUNCTION IF EXISTS public.get_hoot_dealers_for_sync(text);

CREATE OR REPLACE FUNCTION public.get_hoot_dealers_for_sync(
  p_client_id text DEFAULT NULL
)
RETURNS TABLE (
  hoot_config_id   bigint,
  customer_name    text,
  ga4_customer_id  text,
  website_platform text,
  hoot_url         text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    h.id AS hoot_config_id,
    h.customer_name,
    trim(h.ga4_customer_id::text) AS ga4_customer_id,
    h.website_platform,
    h.hoot_url
  FROM public.smart_hoot_config h
  WHERE COALESCE(h.is_active, true) = true
    AND h.ga4_customer_id IS NOT NULL
    AND trim(h.ga4_customer_id::text) <> ''
    AND NULLIF(trim(h.hoot_url), '') IS NOT NULL
    AND (p_client_id IS NULL OR trim(h.ga4_customer_id::text) = trim(p_client_id))
  ORDER BY h.customer_name;
$$;

DROP FUNCTION IF EXISTS public.get_hoot_dealers_daily_status(date);

CREATE OR REPLACE FUNCTION public.get_hoot_dealers_daily_status(
  p_report_date date DEFAULT NULL
)
RETURNS TABLE (
  report_date          date,
  ga4_customer_id      text,
  dealer_name          text,
  transmitted          boolean,
  live_units           bigint,
  transferred_units    bigint,
  first_seen_today     bigint,
  last_seen            timestamptz
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
    FROM public.get_hoot_dealers_for_sync(NULL) s
  ),
  inv AS (
    SELECT
      NULLIF(trim(i.customer_name), '') AS customer_name,
      COUNT(*)::bigint AS live_units,
      COUNT(*) FILTER (
        WHERE (
          COALESCE(i.last_seen, i.first_seen)
            AT TIME ZONE 'Asia/Kolkata'
        )::date = v_date
      )::bigint AS transferred_units,
      COUNT(*) FILTER (
        WHERE (i.first_seen AT TIME ZONE 'Asia/Kolkata')::date = v_date
      )::bigint AS first_seen_today,
      MAX(i.last_seen) AS last_seen
    FROM public.smart_hoot_inventory i
    GROUP BY 1
  )
  SELECT
    v_date AS report_date,
    d.ga4_customer_id,
    d.dealer_name,
    COALESCE(inv.transferred_units, 0) > 0 AS transmitted,
    COALESCE(inv.live_units, 0) AS live_units,
    COALESCE(inv.transferred_units, 0) AS transferred_units,
    COALESCE(inv.first_seen_today, 0) AS first_seen_today,
    inv.last_seen
  FROM dealers d
  LEFT JOIN inv
    ON lower(inv.customer_name) = lower(trim(d.dealer_name))
  ORDER BY d.dealer_name;
END;
$$;

DROP FUNCTION IF EXISTS public.snapshot_hoot_dealers_daily_status(date);

CREATE OR REPLACE FUNCTION public.snapshot_hoot_dealers_daily_status(
  p_report_date date DEFAULT NULL
)
RETURNS TABLE (
  report_date          date,
  ga4_customer_id      text,
  dealer_name          text,
  transmitted          boolean,
  live_units           bigint,
  transferred_units    bigint,
  first_seen_today     bigint,
  last_seen            timestamptz
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
  INSERT INTO public.smart_hoot_daily_status (
    report_date,
    ga4_customer_id,
    dealer_name,
    transmitted,
    live_units,
    transferred_units,
    first_seen_today,
    last_seen,
    checked_at
  )
  SELECT
    s.report_date,
    s.ga4_customer_id,
    s.dealer_name,
    s.transmitted,
    s.live_units,
    s.transferred_units,
    s.first_seen_today,
    s.last_seen,
    now()
  FROM public.get_hoot_dealers_daily_status(v_date) s
  ON CONFLICT (report_date, ga4_customer_id) DO UPDATE SET
    dealer_name         = EXCLUDED.dealer_name,
    transmitted         = EXCLUDED.transmitted,
    live_units          = EXCLUDED.live_units,
    transferred_units   = EXCLUDED.transferred_units,
    first_seen_today    = EXCLUDED.first_seen_today,
    last_seen           = EXCLUDED.last_seen,
    checked_at          = now();

  RETURN QUERY
  SELECT
    t.report_date,
    t.ga4_customer_id,
    t.dealer_name,
    t.transmitted,
    t.live_units,
    t.transferred_units,
    t.first_seen_today,
    t.last_seen
  FROM public.smart_hoot_daily_status t
  WHERE t.report_date = v_date
  ORDER BY t.dealer_name;
END;
$$;

REVOKE ALL ON FUNCTION public.get_hoot_dealers_for_sync(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_hoot_dealers_daily_status(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.snapshot_hoot_dealers_daily_status(date) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_hoot_dealers_for_sync(text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_hoot_dealers_daily_status(date)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.snapshot_hoot_dealers_daily_status(date)
  TO service_role;
