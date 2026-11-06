-- Event Tracking for all dealers from daily summaries, so any date range loads in ~1s.
--   smart_event_tracking_vdp_daily   Final VDP views per dealer/day/channel (page-level split)
--   mv_event_tracking_events_daily   GA4 form events per dealer/day/channel/event
--   smart_events_users               GA4 total users per exact period (not additive across days)
--   get_event_tracking_dashboard     one call for every dealer of a date range
-- Crons (keys live in cron.job, not here): event-tracking-events-sync, event-tracking-users-sync,
-- event-tracking-refresh (events MV), event-tracking-vdp-refresh-a / -b (last 5 days of VDP).

DROP FUNCTION IF EXISTS public.get_event_tracking_dashboard(date, text[]);
DROP FUNCTION IF EXISTS public.refresh_event_tracking_monthly(date, text[]);
DROP MATERIALIZED VIEW IF EXISTS public.mv_event_tracking_events_monthly;
DROP TABLE IF EXISTS public.smart_event_tracking_vdp_monthly;

CREATE OR REPLACE FUNCTION public.event_tracking_channel_name(p_channel text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE lower(btrim(COALESCE(p_channel, '')))
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
    WHEN '(not_set)' THEN 'Unassigned'
    WHEN 'display' THEN 'Display'
    WHEN 'paid_video' THEN 'Paid Video'
    WHEN 'organic_video' THEN 'Organic Video'
    WHEN 'affiliates' THEN 'Affiliates'
    WHEN 'paid_other' THEN 'Paid Other'
    WHEN 'sms' THEN 'SMS'
    WHEN 'audio' THEN 'Audio'
    ELSE initcap(replace(replace(lower(btrim(p_channel)), '_', ' '), '-', ' '))
  END;
$$;

CREATE TABLE IF NOT EXISTS public.smart_event_tracking_vdp_daily (
  client_id    text NOT NULL,
  report_date  date NOT NULL,
  channel      text NOT NULL,
  final_views  bigint NOT NULL DEFAULT 0,
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, report_date, channel)
);
CREATE INDEX IF NOT EXISTS idx_event_tracking_vdp_daily_date
  ON public.smart_event_tracking_vdp_daily (report_date);
ALTER TABLE public.smart_event_tracking_vdp_daily ENABLE ROW LEVEL SECURITY;

-- Final views of each (day, page) are split across channels by that page's GA4 VDP views
-- (largest remainder), so channel values add up exactly to the dealer's Final total.
CREATE OR REPLACE FUNCTION public.refresh_event_tracking_vdp(
  p_from date,
  p_to date,
  p_client_ids text[] DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cid text;
  v_done integer := 0;
BEGIN
  FOR v_cid IN
    SELECT DISTINCT btrim(h.ga4_customer_id)
    FROM public.smart_hoot_config h
    WHERE h.is_active
      AND NULLIF(btrim(h.ga4_customer_id), '') IS NOT NULL
      AND (p_client_ids IS NULL OR btrim(h.ga4_customer_id) = ANY (p_client_ids))
  LOOP
    DELETE FROM public.smart_event_tracking_vdp_daily
    WHERE client_id = v_cid AND report_date BETWEEN p_from AND p_to;

    INSERT INTO public.smart_event_tracking_vdp_daily (client_id, report_date, channel, final_views)
    WITH weights AS (
      SELECT p.report_date,
             COALESCE(btrim(p.page_path), '') AS page_path,
             public.event_tracking_channel_name(p.channel) AS channel,
             SUM(COALESCE(p.views, 0))::bigint AS channel_views
      FROM public.smart_ga4_page_data p
      WHERE p.client_id = v_cid
        AND p.report_date BETWEEN p_from AND p_to
        AND p.vdp_conditions IS TRUE
      GROUP BY 1, 2, 3
      HAVING SUM(COALESCE(p.views, 0)) > 0
    ),
    final_by_page AS (
      SELECT f.report_date,
             COALESCE(btrim(f.page_path), '') AS page_path,
             SUM(COALESCE(f.views, 0))::bigint AS final_views
      FROM public.smart_final_data f
      WHERE f.client_id = v_cid
        AND f.report_date BETWEEN p_from AND p_to
      GROUP BY 1, 2
    ),
    alloc AS (
      SELECT fp.report_date, fp.page_path, fp.final_views,
             COALESCE(w.channel, 'Unassigned') AS channel,
             COALESCE(SUM(w.channel_views) OVER (PARTITION BY fp.report_date, fp.page_path), 0) AS weight_total,
             COALESCE(w.channel_views, 0) AS channel_views
      FROM final_by_page fp
      LEFT JOIN weights w ON w.report_date = fp.report_date AND w.page_path = fp.page_path
    ),
    floors AS (
      SELECT *,
        CASE WHEN weight_total = 0 THEN final_views
             ELSE FLOOR(final_views::numeric * channel_views / weight_total)::bigint END AS floor_views,
        CASE WHEN weight_total = 0 THEN 0::numeric
             ELSE final_views::numeric * channel_views / weight_total
                  - FLOOR(final_views::numeric * channel_views / weight_total) END AS remainder
      FROM alloc
    ),
    ranked AS (
      SELECT *,
        final_views - SUM(floor_views) OVER (PARTITION BY report_date, page_path) AS remaining_views,
        ROW_NUMBER() OVER (PARTITION BY report_date, page_path ORDER BY remainder DESC, channel) AS rnk
      FROM floors
    )
    SELECT v_cid, report_date, channel,
           SUM(floor_views + CASE WHEN weight_total > 0 AND rnk <= remaining_views THEN 1 ELSE 0 END)::bigint
    FROM ranked
    GROUP BY report_date, channel;

    v_done := v_done + 1;
  END LOOP;

  RETURN v_done;
END;
$$;

-- One-off backfill driven by a per-minute cron job (p_job unschedules itself when done).
-- pg_cron runs it in one transaction under a 2-minute statement timeout (no COMMIT),
-- so each run fills the 4 days just before the oldest filled day, working backwards.
CREATE OR REPLACE PROCEDURE public.backfill_event_tracking_vdp(
  IN p_from date,
  IN p_to date,
  IN p_job text DEFAULT NULL
)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_oldest date;
  v_end date;
  v_start date;
BEGIN
  SELECT min(report_date) INTO v_oldest FROM public.smart_event_tracking_vdp_daily;
  v_end := COALESCE(v_oldest - 1, p_to);
  IF v_end > p_to THEN v_end := p_to; END IF;
  v_start := GREATEST(v_end - 3, p_from);

  IF v_end >= p_from THEN
    PERFORM public.refresh_event_tracking_vdp(v_start, v_end);
  END IF;

  IF v_end < p_from OR v_start = p_from OR NOT EXISTS (
    SELECT 1 FROM public.smart_event_tracking_vdp_daily WHERE report_date BETWEEN v_start AND v_end
  ) THEN
    IF p_job IS NOT NULL THEN
      PERFORM cron.unschedule(p_job);
    END IF;
  END IF;
END;
$$;

CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_event_tracking_events_daily AS
SELECT e.client_id,
       e.report_date,
       public.event_tracking_channel_name(e.channel) AS channel,
       e.event_name,
       SUM(e.event_count) AS event_count
FROM public.smart_events_data e
GROUP BY e.client_id, e.report_date, public.event_tracking_channel_name(e.channel), e.event_name;

CREATE UNIQUE INDEX IF NOT EXISTS mv_event_tracking_events_daily_key
  ON public.mv_event_tracking_events_daily (client_id, report_date, channel, event_name);

CREATE OR REPLACE FUNCTION public.refresh_event_tracking_events_mv()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_event_tracking_events_daily;
END;
$$;

-- kind: 'users' (channel '(all)' = whole-site total), 'vdp' (Final views), 'event'.
CREATE OR REPLACE FUNCTION public.get_event_tracking_dashboard(
  p_from date,
  p_to date,
  p_client_ids text[] DEFAULT NULL
)
RETURNS TABLE (
  client_id text,
  kind text,
  channel text,
  event_name text,
  value bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM (
    SELECT u.client_id, 'users'::text AS kind,
           CASE WHEN u.channel = '(all)' THEN '(all)' ELSE public.event_tracking_channel_name(u.channel) END AS channel,
           NULL::text AS event_name, SUM(u.total_users)::bigint AS value
    FROM public.smart_events_users u
    WHERE u.period_from = p_from AND u.period_to = p_to
      AND (p_client_ids IS NULL OR u.client_id = ANY (p_client_ids))
    GROUP BY 1, 3
    UNION ALL
    SELECT v.client_id, 'vdp', v.channel, NULL::text, SUM(v.final_views)::bigint
    FROM public.smart_event_tracking_vdp_daily v
    WHERE v.report_date BETWEEN p_from AND p_to
      AND (p_client_ids IS NULL OR v.client_id = ANY (p_client_ids))
    GROUP BY 1, 3
    UNION ALL
    SELECT e.client_id, 'event', e.channel, e.event_name, SUM(e.event_count)::bigint
    FROM public.mv_event_tracking_events_daily e
    WHERE e.report_date BETWEEN p_from AND p_to
      AND (p_client_ids IS NULL OR e.client_id = ANY (p_client_ids))
    GROUP BY 1, 3, 4
  ) r
  ORDER BY r.client_id, r.kind, r.channel, r.event_name;
$$;

REVOKE ALL ON FUNCTION public.refresh_event_tracking_vdp(date, date, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON PROCEDURE public.backfill_event_tracking_vdp(date, date, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_event_tracking_events_mv() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_event_tracking_dashboard(date, date, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_event_tracking_vdp(date, date, text[]) TO service_role;
GRANT EXECUTE ON PROCEDURE public.backfill_event_tracking_vdp(date, date, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_event_tracking_events_mv() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_event_tracking_dashboard(date, date, text[]) TO service_role;
REVOKE ALL ON public.mv_event_tracking_events_daily FROM anon, authenticated;
