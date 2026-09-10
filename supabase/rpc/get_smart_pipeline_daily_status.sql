-- Daily pipeline coverage for Smart Analytics Data Update email.
-- Fast path: EXISTS probes per active dealer (uses client_id+report_date indexes).
-- Avoids full-table COUNT(DISTINCT)/COUNT(*) over smart_ga4_page_data / smart_final_data
-- which timed out Edge Functions (~120s). Row totals are omitted (0) — dealer coverage
-- is what the email verdict uses; per-dealer row totals come from get_smart_final_daily_status.

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
