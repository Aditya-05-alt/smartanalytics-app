-- Admin pipeline bottom tables — one RPC for all 4 metrics per day.
-- Replaces 4 separate calls (build_date_wise_ga4_data x2, build_date_wise_final_data,
-- build_date_wise_hoot_match) with a single round trip per day/chunk.
--
-- Recommended indexes (run once):
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ga4_page_data_date_client
--   ON public.smart_ga4_page_data (report_date, client_id);
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_final_data_date_client
--   ON public.smart_final_data (report_date, client_id);
--
-- Deploy in Supabase SQL editor, then reload PostgREST schema cache if needed.

DROP FUNCTION IF EXISTS public.build_pipeline_range_views(date, date, text);

CREATE OR REPLACE FUNCTION public.build_pipeline_range_views(
  p_date_from date DEFAULT NULL,
  p_date_to   date DEFAULT NULL,
  p_client_id text DEFAULT NULL
)
RETURNS TABLE (
  report_date       date,
  client_id         text,
  ga4_page_views    bigint,
  ga4_filter_views  bigint,
  final_vdp_views   bigint,
  hoot_matched      bigint,
  hoot_non_matched  bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH page_daily AS (
    SELECT
      p.report_date,
      p.client_id::text AS client_id,
      COALESCE(SUM(p.views), 0)::bigint AS ga4_page_views,
      COALESCE(SUM(p.views) FILTER (WHERE p.vdp_conditions IS TRUE), 0)::bigint AS ga4_filter_views
    FROM public.smart_ga4_page_data p
    WHERE p.report_date >= COALESCE(p_date_from, p.report_date)
      AND p.report_date <= COALESCE(p_date_to, p.report_date)
      AND (
        p_client_id IS NULL
        OR p.client_id::text = trim(p_client_id)
      )
    GROUP BY p.report_date, p.client_id
  ),
  final_daily AS (
    SELECT
      f.report_date,
      f.client_id::text AS client_id,
      COALESCE(SUM(f.views), 0)::bigint AS final_vdp_views,
      COALESCE(SUM(f.views) FILTER (WHERE f.vdp_conditions IS TRUE), 0)::bigint AS hoot_matched,
      COALESCE(SUM(f.views) FILTER (WHERE f.vdp_conditions IS NOT TRUE), 0)::bigint AS hoot_non_matched
    FROM public.smart_final_data f
    WHERE f.report_date >= COALESCE(p_date_from, f.report_date)
      AND f.report_date <= COALESCE(p_date_to, f.report_date)
      AND (
        p_client_id IS NULL
        OR f.client_id::text = trim(p_client_id)
      )
    GROUP BY f.report_date, f.client_id
  ),
  all_days AS (
    SELECT report_date, client_id FROM page_daily
    UNION
    SELECT report_date, client_id FROM final_daily
  )
  SELECT
    d.report_date,
    d.client_id,
    COALESCE(p.ga4_page_views, 0)::bigint AS ga4_page_views,
    COALESCE(p.ga4_filter_views, 0)::bigint AS ga4_filter_views,
    COALESCE(f.final_vdp_views, 0)::bigint AS final_vdp_views,
    COALESCE(f.hoot_matched, 0)::bigint AS hoot_matched,
    COALESCE(f.hoot_non_matched, 0)::bigint AS hoot_non_matched
  FROM all_days d
  LEFT JOIN page_daily p USING (report_date, client_id)
  LEFT JOIN final_daily f USING (report_date, client_id)
  ORDER BY d.report_date, d.client_id;
$$;

GRANT EXECUTE ON FUNCTION public.build_pipeline_range_views(date, date, text)
  TO anon, authenticated, service_role;
