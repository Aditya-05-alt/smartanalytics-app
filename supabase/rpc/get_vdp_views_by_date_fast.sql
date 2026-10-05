-- Daily VDP views (no inventory/channel filters) for the Overview KPI + chart.
-- Settled days come from mv_ga4_vdp_channel_daily (refreshed nightly); only days that can
-- differ from the MV are read live from smart_ga4_page_data:
--   * the last p_live_days days (GA4 still settling / nightly filtration rewrites them),
--   * days whose GA4 sync completed after the MV's last refresh started,
--   * days missing from the MV entirely.
-- Live reads of freshly rewritten rows hit the heap, so keeping them to a few days keeps
-- heavy dealers well under a second instead of 15–50s for a month.

CREATE OR REPLACE FUNCTION public.get_vdp_views_by_date_fast(
  p_client_id text,
  p_from date,
  p_to date,
  p_live_days integer DEFAULT 3
)
RETURNS TABLE (report_date date, views bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '55s'
AS $$
DECLARE
  v_client text := btrim(p_client_id);
  v_live_from date := (now() AT TIME ZONE 'utc')::date - GREATEST(COALESCE(p_live_days, 3), 0);
  v_mv_at timestamptz;
  v_live_dates date[];
BEGIN
  SELECT max(r.start_time) INTO v_mv_at
  FROM cron.job_run_details r
  JOIN cron.job j ON j.jobid = r.jobid
  WHERE j.jobname = 'refresh-mv-ga4-vdp-channel-daily'
    AND r.status = 'succeeded';

  SELECT COALESCE(array_agg(d.d), '{}')
  INTO v_live_dates
  FROM (
    SELECT gs::date AS d FROM generate_series(p_from, p_to, interval '1 day') gs
  ) d
  WHERE v_mv_at IS NULL
     OR d.d >= v_live_from
     OR EXISTS (
       SELECT 1 FROM smart_ga4_day_complete c
       WHERE c.client_id = v_client AND c.report_date = d.d AND c.completed_at >= v_mv_at
     )
     OR NOT EXISTS (
       SELECT 1 FROM mv_ga4_vdp_channel_daily m
       WHERE m.client_id = v_client AND m.report_date = d.d
     );

  RETURN QUERY EXECUTE $q$
    SELECT m.report_date, sum(m.views)::bigint
    FROM mv_ga4_vdp_channel_daily m
    WHERE m.client_id = $1
      AND m.report_date BETWEEN $2 AND $3
      AND NOT (m.report_date = ANY ($4))
    GROUP BY m.report_date
    UNION ALL
    SELECT p.report_date, sum(COALESCE(p.views, 0))::bigint
    FROM smart_ga4_page_data p
    WHERE p.client_id = $1
      AND p.report_date = ANY ($4)
      AND p.vdp_conditions IS TRUE
    GROUP BY p.report_date
    ORDER BY 1
  $q$ USING v_client, p_from, p_to, v_live_dates;
END;
$$;

REVOKE ALL ON FUNCTION public.get_vdp_views_by_date_fast(text, date, date, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_vdp_views_by_date_fast(text, date, date, integer) TO authenticated, service_role;
