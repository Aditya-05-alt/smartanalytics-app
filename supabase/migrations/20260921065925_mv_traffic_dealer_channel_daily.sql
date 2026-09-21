-- APPLIED 2026-09-21 on Smart Analytics V2 (rllwmeqingvuohyctddg).
-- First fill: 213,820 rows (~33 MB), 2025-08-17 → 2026-09-20.
-- Traffic dashboard MV: pre-aggregate sessions / users / page views / VDP by
-- dealer × day × channel so /dashboard/traffic does not scan smart_ga4_page_data.
-- Rolling 400 days covers MoM and YoY compare ranges used on the Traffic page.
-- First fill is WITH NO DATA; run REFRESH (non-concurrent) once after deploy,
-- then daily CONCURRENTLY via cron.

DROP MATERIALIZED VIEW IF EXISTS public.mv_traffic_dealer_channel_daily CASCADE;

CREATE MATERIALIZED VIEW public.mv_traffic_dealer_channel_daily AS
SELECT
  p.client_id,
  p.report_date,
  COALESCE(NULLIF(btrim(p.channel), ''), '(not set)') AS channel,
  COALESCE(SUM(p.sessions), 0)::bigint AS sessions,
  COALESCE(SUM(p.total_users), 0)::bigint AS users,
  COALESCE(SUM(p.views), 0)::bigint AS page_views,
  COALESCE(SUM(p.views) FILTER (WHERE p.vdp_conditions IS TRUE), 0)::bigint AS vdp_views
FROM public.smart_ga4_page_data p
WHERE p.report_date >= ((CURRENT_DATE AT TIME ZONE 'Asia/Kolkata')::date - 400)
GROUP BY p.client_id, p.report_date, COALESCE(NULLIF(btrim(p.channel), ''), '(not set)')
WITH NO DATA;

CREATE UNIQUE INDEX mv_traffic_dealer_channel_daily_uid
  ON public.mv_traffic_dealer_channel_daily (client_id, report_date, channel);

CREATE INDEX mv_traffic_dealer_channel_daily_date_client
  ON public.mv_traffic_dealer_channel_daily (report_date, client_id);

CREATE INDEX mv_traffic_dealer_channel_daily_client_date
  ON public.mv_traffic_dealer_channel_daily (client_id, report_date);

COMMENT ON MATERIALIZED VIEW public.mv_traffic_dealer_channel_daily IS
  'Rolling 400-day dealer×day×channel traffic (sessions, users, page views, VDP). Source for Traffic dashboard RPCs.';

REVOKE ALL ON TABLE public.mv_traffic_dealer_channel_daily FROM PUBLIC;
GRANT SELECT ON TABLE public.mv_traffic_dealer_channel_daily TO service_role;

-- RPCs read the MV (fast). Same signatures as before.
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

-- Daily refresh after GA4 channel MVs (03:30 UTC = 9:00 AM IST).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-mv-traffic-dealer-channel-daily') THEN
    PERFORM cron.unschedule('refresh-mv-traffic-dealer-channel-daily');
  END IF;
END $$;

SELECT cron.schedule(
  'refresh-mv-traffic-dealer-channel-daily',
  '30 3 * * *',
  $cron$
  SET statement_timeout TO '900000';
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_traffic_dealer_channel_daily;
  $cron$
);
