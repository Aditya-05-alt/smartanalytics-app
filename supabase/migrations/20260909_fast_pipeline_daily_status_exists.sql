-- Fix smart-final-daily-status Edge timeouts (upstream request timeout ~120s).
-- get_smart_pipeline_daily_status: EXISTS dealer probes instead of full-table COUNT(DISTINCT).
-- get_smart_final_daily_status: join active dealers, drop per-row timezone cast for rebuilt_today.
-- Mirror: supabase/rpc/get_smart_pipeline_daily_status.sql
-- Mirror: supabase/rpc/get_smart_final_daily_status.sql

CREATE OR REPLACE FUNCTION public.get_smart_pipeline_daily_status(
  p_days_back integer DEFAULT 5
)
RETURNS TABLE (
  report_date date,
  ga4_dealers bigint,
  ga4_rows bigint,
  vdp_dealers bigint,
  vdp_rows bigint,
  final_dealers bigint,
  final_rows bigint,
  active_dealers bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '60s'
AS $$
  WITH bounds AS (
    SELECT
      (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date AS today_ist,
      GREATEST(COALESCE(p_days_back, 5), 1) AS days_back
  ),
  days AS (
    SELECT generate_series(
      (SELECT today_ist - days_back FROM bounds),
      (SELECT today_ist FROM bounds),
      interval '1 day'
    )::date AS report_date
  ),
  active AS (
    SELECT DISTINCT trim(c.client_id::text) AS client_id
    FROM public.smart_ga4_config c
    WHERE c.is_active IS TRUE
      AND c.client_id IS NOT NULL
      AND trim(c.client_id::text) <> ''
  ),
  active_count AS (
    SELECT COUNT(*)::bigint AS active_dealers FROM active
  )
  SELECT
    d.report_date,
    (
      SELECT COUNT(*)::bigint
      FROM active a
      WHERE EXISTS (
        SELECT 1
        FROM public.smart_ga4_page_data g
        WHERE g.client_id = a.client_id
          AND g.report_date = d.report_date
        LIMIT 1
      )
    ) AS ga4_dealers,
    0::bigint AS ga4_rows,
    (
      SELECT COUNT(*)::bigint
      FROM active a
      WHERE EXISTS (
        SELECT 1
        FROM public.smart_ga4_page_data g
        WHERE g.client_id = a.client_id
          AND g.report_date = d.report_date
          AND g.vdp_conditions IS TRUE
        LIMIT 1
      )
    ) AS vdp_dealers,
    0::bigint AS vdp_rows,
    (
      SELECT COUNT(*)::bigint
      FROM active a
      WHERE EXISTS (
        SELECT 1
        FROM public.smart_final_data f
        WHERE f.client_id = a.client_id
          AND f.report_date = d.report_date
        LIMIT 1
      )
    ) AS final_dealers,
    0::bigint AS final_rows,
    ac.active_dealers
  FROM days d
  CROSS JOIN active_count ac
  ORDER BY d.report_date;
$$;

COMMENT ON FUNCTION public.get_smart_pipeline_daily_status(integer) IS
  'Fast daily Step 1/2/3 dealer coverage (EXISTS probes). Row totals intentionally 0 — use get_smart_final_daily_status for row detail.';

GRANT EXECUTE ON FUNCTION public.get_smart_pipeline_daily_status(integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.get_smart_final_daily_status(
  p_days_back integer DEFAULT 7
)
RETURNS TABLE (
  client_id text,
  account_name text,
  cms text,
  total_rows bigint,
  matched_rows bigint,
  min_report_date date,
  max_report_date date,
  rebuilt_today boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '60s'
AS $$
  WITH bounds AS (
    SELECT
      (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date AS today_ist,
      GREATEST(COALESCE(p_days_back, 7), 1) AS days_back,
      ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date::timestamp
        AT TIME ZONE 'Asia/Kolkata') AS today_ist_start
  ),
  active AS (
    SELECT
      trim(c.client_id::text) AS client_id,
      MAX(c.account_name)::text AS account_name
    FROM public.smart_ga4_config c
    WHERE c.is_active IS TRUE
      AND c.client_id IS NOT NULL
      AND trim(c.client_id::text) <> ''
    GROUP BY trim(c.client_id::text)
  ),
  agg AS (
    SELECT
      f.client_id,
      MAX(f.account_name)::text AS account_name,
      MAX(f.cms)::text AS cms,
      COUNT(*)::bigint AS total_rows,
      COUNT(*) FILTER (WHERE f.vdp_conditions IS TRUE)::bigint AS matched_rows,
      MIN(f.report_date) AS min_report_date,
      MAX(f.report_date) AS max_report_date,
      (MAX(f.created_at) >= (SELECT today_ist_start FROM bounds)) AS rebuilt_today
    FROM public.smart_final_data f
    INNER JOIN active a ON a.client_id = f.client_id
    CROSS JOIN bounds b
    WHERE f.report_date >= b.today_ist - b.days_back
      AND f.report_date <= b.today_ist
    GROUP BY f.client_id
  )
  SELECT
    a.client_id,
    COALESCE(g.account_name, a.account_name)::text AS account_name,
    g.cms,
    COALESCE(g.total_rows, 0)::bigint AS total_rows,
    COALESCE(g.matched_rows, 0)::bigint AS matched_rows,
    g.min_report_date,
    g.max_report_date,
    COALESCE(g.rebuilt_today, false) AS rebuilt_today
  FROM active a
  LEFT JOIN agg g ON g.client_id = a.client_id
  ORDER BY COALESCE(g.account_name, a.account_name);
$$;

COMMENT ON FUNCTION public.get_smart_final_daily_status(integer) IS
  'Step 3 daily email — per active dealer smart_final_data coverage (rolling days + rebuilt today IST).';

GRANT EXECUTE ON FUNCTION public.get_smart_final_daily_status(integer)
  TO service_role;
