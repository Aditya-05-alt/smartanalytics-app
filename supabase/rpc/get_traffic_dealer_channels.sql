-- Traffic report RPCs — read mv_traffic_dealer_channel_daily (not smart_ga4_page_data).

CREATE OR REPLACE FUNCTION public.get_traffic_dealer_channels(
  p_client_id text,
  p_from date,
  p_to date
)
RETURNS TABLE (
  channel text,
  sessions bigint,
  users bigint,
  page_views bigint,
  vdp_views bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '30s'
AS $$
  SELECT
    m.channel,
    COALESCE(SUM(m.sessions), 0)::bigint AS sessions,
    COALESCE(SUM(m.users), 0)::bigint AS users,
    COALESCE(SUM(m.page_views), 0)::bigint AS page_views,
    COALESCE(SUM(m.vdp_views), 0)::bigint AS vdp_views
  FROM public.mv_traffic_dealer_channel_daily m
  WHERE m.client_id = btrim(p_client_id)
    AND m.report_date BETWEEN p_from AND p_to
  GROUP BY m.channel
  ORDER BY 2 DESC, 1;
$$;

COMMENT ON FUNCTION public.get_traffic_dealer_channels(text, date, date) IS
  'Traffic dashboard: channel totals from mv_traffic_dealer_channel_daily for one dealer.';

REVOKE ALL ON FUNCTION public.get_traffic_dealer_channels(text, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_traffic_dealer_channels(text, date, date)
  TO service_role;

CREATE OR REPLACE FUNCTION public.get_traffic_dealers_channels(
  p_client_ids text[],
  p_from date,
  p_to date
)
RETURNS TABLE (
  client_id text,
  channel text,
  sessions bigint,
  users bigint,
  page_views bigint,
  vdp_views bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '30s'
AS $$
  SELECT
    m.client_id,
    m.channel,
    COALESCE(SUM(m.sessions), 0)::bigint AS sessions,
    COALESCE(SUM(m.users), 0)::bigint AS users,
    COALESCE(SUM(m.page_views), 0)::bigint AS page_views,
    COALESCE(SUM(m.vdp_views), 0)::bigint AS vdp_views
  FROM unnest(p_client_ids) AS ids(client_id)
  JOIN public.mv_traffic_dealer_channel_daily m
    ON m.client_id = ids.client_id
   AND m.report_date BETWEEN p_from AND p_to
  GROUP BY 1, 2;
$$;

COMMENT ON FUNCTION public.get_traffic_dealers_channels(text[], date, date) IS
  'Traffic dashboard: channel totals from mv_traffic_dealer_channel_daily for several dealers.';

REVOKE ALL ON FUNCTION public.get_traffic_dealers_channels(text[], date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_traffic_dealers_channels(text[], date, date)
  TO service_role;
