-- Mirror of supabase/rpc/get_smart_pipeline_daily_status.sql
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
    SELECT COUNT(DISTINCT trim(c.client_id::text))::bigint AS active_dealers
    FROM public.smart_ga4_config c
    WHERE c.is_active IS TRUE
      AND c.client_id IS NOT NULL
      AND trim(c.client_id::text) <> ''
  ),
  ga4 AS (
    SELECT
      g.report_date,
      COUNT(DISTINCT trim(g.client_id))::bigint AS ga4_dealers,
      COUNT(*)::bigint AS ga4_rows,
      COUNT(DISTINCT trim(g.client_id)) FILTER (WHERE g.vdp_conditions IS TRUE)::bigint AS vdp_dealers,
      COUNT(*) FILTER (WHERE g.vdp_conditions IS TRUE)::bigint AS vdp_rows
    FROM public.smart_ga4_page_data g
    CROSS JOIN bounds b
    WHERE g.report_date >= b.today_ist - b.days_back
      AND g.report_date <= b.today_ist
    GROUP BY g.report_date
  ),
  final AS (
    SELECT
      f.report_date,
      COUNT(DISTINCT trim(f.client_id))::bigint AS final_dealers,
      COUNT(*)::bigint AS final_rows
    FROM public.smart_final_data f
    CROSS JOIN bounds b
    WHERE f.report_date >= b.today_ist - b.days_back
      AND f.report_date <= b.today_ist
    GROUP BY f.report_date
  )
  SELECT
    d.report_date,
    COALESCE(g.ga4_dealers, 0)::bigint AS ga4_dealers,
    COALESCE(g.ga4_rows, 0)::bigint AS ga4_rows,
    COALESCE(g.vdp_dealers, 0)::bigint AS vdp_dealers,
    COALESCE(g.vdp_rows, 0)::bigint AS vdp_rows,
    COALESCE(f.final_dealers, 0)::bigint AS final_dealers,
    COALESCE(f.final_rows, 0)::bigint AS final_rows,
    a.active_dealers
  FROM days d
  CROSS JOIN active a
  LEFT JOIN ga4 g ON g.report_date = d.report_date
  LEFT JOIN final f ON f.report_date = d.report_date
  ORDER BY d.report_date;
$$;

GRANT EXECUTE ON FUNCTION public.get_smart_pipeline_daily_status(integer)
  TO service_role;
