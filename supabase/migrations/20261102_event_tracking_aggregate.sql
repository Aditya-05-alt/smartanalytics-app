CREATE OR REPLACE FUNCTION public.get_event_tracking_metrics(
  p_client_id text,
  p_property_id text,
  p_current_from date,
  p_current_to date,
  p_previous_from date,
  p_previous_to date,
  p_average_from date,
  p_average_to date
)
RETURNS TABLE (
  period smallint,
  channel text,
  total_users bigint,
  final_views bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '55s'
AS $$
  WITH periods AS (
    SELECT 0::smallint AS period
    UNION ALL
    SELECT 1::smallint
    UNION ALL
    SELECT 2::smallint
  ),
  ga4_rows AS MATERIALIZED (
    SELECT
      CASE
        WHEN p.report_date BETWEEN p_current_from AND p_current_to THEN 0::smallint
        WHEN p.report_date BETWEEN p_previous_from AND p_previous_to THEN 1::smallint
        ELSE 2::smallint
      END AS period,
      p.report_date,
      COALESCE(btrim(p.page_path), '') AS page_path,
      p.channel,
      p.total_users,
      p.views,
      p.vdp_conditions
    FROM public.smart_ga4_page_data p
    WHERE btrim(p.client_id::text) = btrim(p_client_id)
      AND p.report_date BETWEEN p_average_from AND p_current_to
      AND (
        p_property_id IS NULL
        OR NULLIF(
          regexp_replace(btrim(p.ga4_property_id::text), '^properties/', '', 'i'),
          ''
        ) = btrim(p_property_id)
      )
  ),
  ga4_by_channel AS (
    SELECT
      period,
      channel,
      COALESCE(SUM(total_users), 0)::bigint AS total_users
    FROM ga4_rows
    GROUP BY period, channel
  ),
  page_weights AS (
    SELECT
      period,
      report_date,
      page_path,
      channel,
      COALESCE(
        SUM(views) FILTER (WHERE vdp_conditions IS TRUE),
        0
      )::bigint AS channel_views
    FROM ga4_rows
    WHERE vdp_conditions IS TRUE
    GROUP BY period, report_date, page_path, channel
  ),
  final_rows AS MATERIALIZED (
    SELECT
      CASE
        WHEN f.report_date BETWEEN p_current_from AND p_current_to THEN 0::smallint
        WHEN f.report_date BETWEEN p_previous_from AND p_previous_to THEN 1::smallint
        ELSE 2::smallint
      END AS period,
      f.report_date,
      COALESCE(btrim(f.page_path), '') AS page_path,
      f.views
    FROM public.smart_final_data f
    WHERE btrim(f.client_id::text) = btrim(p_client_id)
      AND f.report_date BETWEEN p_average_from AND p_current_to
      AND (
        p_property_id IS NULL
        OR NULLIF(
          regexp_replace(btrim(f.ga4_property_id::text), '^properties/', '', 'i'),
          ''
        ) = btrim(p_property_id)
      )
  ),
  final_by_page AS (
    SELECT
      period,
      report_date,
      page_path,
      COALESCE(SUM(views), 0)::bigint AS final_views
    FROM final_rows
    GROUP BY period, report_date, page_path
  ),
  page_allocations AS (
    SELECT
      final_by_page.period,
      final_by_page.report_date,
      final_by_page.page_path,
      page_weights.channel,
      final_by_page.final_views,
      COALESCE(SUM(page_weights.channel_views) OVER (
        PARTITION BY final_by_page.report_date, final_by_page.page_path
      ), 0)::bigint AS weight_total,
      COALESCE(page_weights.channel_views, 0)::bigint AS channel_views
    FROM final_by_page
    LEFT JOIN page_weights
      ON page_weights.period = final_by_page.period
      AND page_weights.report_date = final_by_page.report_date
      AND page_weights.page_path = final_by_page.page_path
  ),
  allocation_floors AS (
    SELECT
      *,
      CASE
        WHEN weight_total = 0 THEN final_views
        ELSE FLOOR(final_views::numeric * channel_views / weight_total)::bigint
      END AS floor_views,
      CASE
        WHEN weight_total = 0 THEN 0::numeric
        ELSE final_views::numeric * channel_views / weight_total
          - FLOOR(final_views::numeric * channel_views / weight_total)
      END AS remainder
    FROM page_allocations
  ),
  ranked_allocations AS (
    SELECT
      *,
      final_views - SUM(floor_views) OVER (
        PARTITION BY report_date, page_path
      ) AS remaining_views,
      ROW_NUMBER() OVER (
        PARTITION BY report_date, page_path
        ORDER BY remainder DESC, channel NULLS FIRST
      ) AS allocation_rank
    FROM allocation_floors
  ),
  final_by_channel AS (
    SELECT
      period,
      channel,
      SUM(
        floor_views + CASE
          WHEN weight_total > 0 AND allocation_rank <= remaining_views THEN 1
          ELSE 0
        END
      )::bigint AS final_views
    FROM ranked_allocations
    GROUP BY period, channel
  ),
  channel_metrics AS (
    SELECT
      COALESCE(ga4_by_channel.period, final_by_channel.period) AS period,
      COALESCE(ga4_by_channel.channel, final_by_channel.channel) AS channel,
      COALESCE(ga4_by_channel.total_users, 0)::bigint AS total_users,
      COALESCE(final_by_channel.final_views, 0)::bigint AS final_views
    FROM ga4_by_channel
    FULL OUTER JOIN final_by_channel
      ON final_by_channel.period = ga4_by_channel.period
      AND final_by_channel.channel IS NOT DISTINCT FROM ga4_by_channel.channel
  )
  SELECT
    periods.period,
    channel_metrics.channel,
    COALESCE(channel_metrics.total_users, 0)::bigint,
    COALESCE(channel_metrics.final_views, 0)::bigint
  FROM periods
  LEFT JOIN channel_metrics USING (period)
  ORDER BY periods.period, channel_metrics.channel;
$$;

REVOKE ALL ON FUNCTION public.get_event_tracking_metrics(
  text, text, date, date, date, date, date, date
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_event_tracking_metrics(
  text, text, date, date, date, date, date, date
) TO service_role;
