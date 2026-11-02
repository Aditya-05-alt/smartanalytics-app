-- Per-channel users and allocated final VDP views for one client and date window.
-- Final views are allocated to channels per (report_date, page_path) using the
-- GA4 VDP views of each channel as weights (largest-remainder rounding), so the
-- result is additive across date windows and can be fetched in chunks.
CREATE OR REPLACE FUNCTION public.get_event_tracking_channel_metrics(
  p_client_id text,
  p_from date,
  p_to date
)
RETURNS TABLE (
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
  WITH ga4_rows AS MATERIALIZED (
    SELECT
      p.report_date,
      COALESCE(btrim(p.page_path), '') AS page_path,
      CASE lower(btrim(COALESCE(p.channel, '')))
        WHEN 'organic_search' THEN 'Organic Search'
        WHEN 'organicsearch' THEN 'Organic Search'
        WHEN 'paid_search' THEN 'Paid Search'
        WHEN 'paidsearch' THEN 'Paid Search'
        WHEN 'direct' THEN 'Direct'
        WHEN 'paid_social' THEN 'Paid Social'
        WHEN 'paidsocial' THEN 'Paid Social'
        WHEN 'organic_social' THEN 'Organic Social'
        WHEN 'organicsocial' THEN 'Organic Social'
        WHEN 'cross-network' THEN 'Cross-network'
        WHEN 'cross_network' THEN 'Cross-network'
        WHEN 'referral' THEN 'Referral'
        WHEN 'email' THEN 'Email'
        WHEN 'ai_assistant' THEN 'AI Assistant'
        WHEN 'ai assistant' THEN 'AI Assistant'
        WHEN 'unassigned' THEN 'Unassigned'
        WHEN '' THEN 'Unassigned'
        WHEN '(not set)' THEN 'Unassigned'
        WHEN 'display' THEN 'Display'
        WHEN 'paid_video' THEN 'Paid Video'
        WHEN 'organic_video' THEN 'Organic Video'
        WHEN 'affiliates' THEN 'Affiliates'
        WHEN 'paid_other' THEN 'Paid Other'
        WHEN 'sms' THEN 'SMS'
        WHEN 'audio' THEN 'Audio'
        ELSE initcap(replace(replace(lower(btrim(p.channel)), '_', ' '), '-', ' '))
      END AS channel,
      p.total_users,
      p.views,
      p.vdp_conditions
    FROM public.smart_ga4_page_data p
    WHERE p.client_id::text = btrim(p_client_id)
      AND p.report_date BETWEEN p_from AND p_to
  ),
  ga4_by_channel AS (
    SELECT channel, COALESCE(SUM(total_users), 0)::bigint AS total_users
    FROM ga4_rows
    GROUP BY channel
  ),
  page_weights AS (
    SELECT
      report_date,
      page_path,
      channel,
      COALESCE(SUM(views), 0)::bigint AS channel_views
    FROM ga4_rows
    WHERE vdp_conditions IS TRUE
    GROUP BY report_date, page_path, channel
  ),
  final_by_page AS (
    SELECT
      f.report_date,
      COALESCE(btrim(f.page_path), '') AS page_path,
      COALESCE(SUM(f.views), 0)::bigint AS final_views
    FROM public.smart_final_data f
    WHERE f.client_id::text = btrim(p_client_id)
      AND f.report_date BETWEEN p_from AND p_to
    GROUP BY f.report_date, COALESCE(btrim(f.page_path), '')
  ),
  page_allocations AS (
    SELECT
      fp.report_date,
      fp.page_path,
      COALESCE(pw.channel, 'Unassigned') AS channel,
      fp.final_views,
      COALESCE(SUM(pw.channel_views) OVER (
        PARTITION BY fp.report_date, fp.page_path
      ), 0)::bigint AS weight_total,
      COALESCE(pw.channel_views, 0)::bigint AS channel_views
    FROM final_by_page fp
    LEFT JOIN page_weights pw
      ON pw.report_date = fp.report_date
      AND pw.page_path = fp.page_path
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
        ORDER BY remainder DESC, channel
      ) AS allocation_rank
    FROM allocation_floors
  ),
  final_by_channel AS (
    SELECT
      channel,
      SUM(
        floor_views + CASE
          WHEN weight_total > 0 AND allocation_rank <= remaining_views THEN 1
          ELSE 0
        END
      )::bigint AS final_views
    FROM ranked_allocations
    GROUP BY channel
  )
  SELECT
    COALESCE(g.channel, f.channel) AS channel,
    COALESCE(g.total_users, 0)::bigint AS total_users,
    COALESCE(f.final_views, 0)::bigint AS final_views
  FROM ga4_by_channel g
  FULL OUTER JOIN final_by_channel f ON f.channel = g.channel
  ORDER BY 1;
$$;

REVOKE ALL ON FUNCTION public.get_event_tracking_channel_metrics(text, date, date)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_event_tracking_channel_metrics(text, date, date)
  TO service_role;
