-- Per-dealer smart_final_data status for daily email (Step 3).
-- p_days_back: rolling report_date window (default 7, matches master sync).

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
AS $$
  WITH bounds AS (
    SELECT
      (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date AS today_ist,
      GREATEST(COALESCE(p_days_back, 7), 1) AS days_back
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
      trim(f.client_id) AS client_id,
      MAX(f.account_name)::text AS account_name,
      MAX(f.cms)::text AS cms,
      COUNT(*)::bigint AS total_rows,
      COUNT(*) FILTER (WHERE f.vdp_conditions IS TRUE)::bigint AS matched_rows,
      MIN(f.report_date) AS min_report_date,
      MAX(f.report_date) AS max_report_date,
      BOOL_OR(
        (f.created_at AT TIME ZONE 'Asia/Kolkata')::date =
          (SELECT today_ist FROM bounds)
      ) AS rebuilt_today
    FROM public.smart_final_data f
    CROSS JOIN bounds b
    WHERE f.report_date >= b.today_ist - b.days_back
    GROUP BY trim(f.client_id)
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
