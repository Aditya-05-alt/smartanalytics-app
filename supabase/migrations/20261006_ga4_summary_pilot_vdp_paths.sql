-- GA4 summary pilot: per-page VDP rows (with channel) so channel / inventory filters
-- for pilot dealers stop joining smart_final_data against smart_ga4_page_data.

ALTER TABLE public.smart_sum_pilot     ADD COLUMN IF NOT EXISTS path_from date DEFAULT '2026-01-01';
ALTER TABLE public.smart_sum_day_state ADD COLUMN IF NOT EXISTS path_refreshed_at timestamptz;

UPDATE public.smart_sum_pilot SET path_from = '2026-01-01' WHERE path_from IS NULL;

CREATE TABLE IF NOT EXISTS public.smart_sum_ga4_vdp_path_daily (
  client_id        text   NOT NULL,
  report_date      date   NOT NULL,
  ga4_property_id  text,
  page_path        text,
  page_path_q_s    text,
  channel          text,
  ga4_page_type    text,
  views            bigint NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS smart_sum_ga4_vdp_path_daily_client_date_idx
  ON public.smart_sum_ga4_vdp_path_daily (client_id, report_date);

ALTER TABLE public.smart_sum_ga4_vdp_path_daily ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.refresh_ga4_summary_range(p_client_id text, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '10min'
AS $function$
DECLARE
  v_client    text := btrim(p_client_id);
  v_rows      bigint;
  v_views     bigint;
  v_path_from date;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad range');
  END IF;

  SELECT path_from INTO v_path_from FROM smart_sum_pilot WHERE client_id = v_client;

  DROP TABLE IF EXISTS tmp_sum_src;
  CREATE TEMP TABLE tmp_sum_src ON COMMIT DROP AS
  SELECT p.report_date,
         COALESCE(NULLIF(btrim(p.ga4_property_id), ''), '') AS prop,
         COALESCE(p.ga4_page_type, '')                      AS page_type,
         (p.vdp_conditions IS TRUE)                          AS is_vdp,
         COALESCE(p.channel, '')                             AS channel,
         p.page_path,
         COALESCE(p.views, 0)::bigint                        AS views,
         p.ga4_property_id                                   AS raw_prop,
         p.channel                                           AS raw_channel,
         p.ga4_page_type                                     AS raw_page_type,
         p.page_path_q_s
  FROM smart_ga4_page_data p
  WHERE p.client_id = v_client
    AND p.report_date BETWEEN p_from AND p_to;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  DELETE FROM smart_sum_ga4_channel_daily  WHERE client_id = v_client AND report_date BETWEEN p_from AND p_to;
  DELETE FROM smart_sum_ga4_overview_daily WHERE client_id = v_client AND report_date BETWEEN p_from AND p_to;
  DELETE FROM smart_sum_ga4_vdp_path_daily WHERE client_id = v_client AND report_date BETWEEN p_from AND p_to;

  INSERT INTO smart_sum_ga4_channel_daily (client_id, report_date, ga4_property_id, ga4_page_type, is_vdp, channel, views)
  SELECT v_client, report_date, prop, page_type, is_vdp, channel, SUM(views)
  FROM tmp_sum_src
  GROUP BY report_date, prop, page_type, is_vdp, channel;

  INSERT INTO smart_sum_ga4_overview_daily (client_id, report_date, ga4_property_id, ga4_page_type, views, unique_pages)
  SELECT v_client, report_date, prop, page_type, SUM(views), COUNT(DISTINCT page_path)
  FROM tmp_sum_src
  GROUP BY report_date, prop, page_type
  UNION ALL
  SELECT v_client, report_date, '*', page_type, SUM(views), COUNT(DISTINCT page_path)
  FROM tmp_sum_src
  GROUP BY report_date, page_type;

  IF v_path_from IS NOT NULL THEN
    INSERT INTO smart_sum_ga4_vdp_path_daily
      (client_id, report_date, ga4_property_id, page_path, page_path_q_s, channel, ga4_page_type, views)
    SELECT v_client, report_date, raw_prop, page_path, page_path_q_s, raw_channel, raw_page_type, SUM(views)
    FROM tmp_sum_src
    WHERE is_vdp AND report_date >= v_path_from
    GROUP BY report_date, raw_prop, page_path, page_path_q_s, raw_channel, raw_page_type;
  END IF;

  INSERT INTO smart_sum_day_state (client_id, report_date, refreshed_at, views, path_refreshed_at)
  SELECT v_client, d::date, now(),
         COALESCE((SELECT SUM(s.views) FROM tmp_sum_src s WHERE s.report_date = d::date), 0),
         CASE WHEN v_path_from IS NOT NULL AND d::date >= v_path_from THEN now() END
  FROM generate_series(p_from, p_to, interval '1 day') d
  ON CONFLICT (client_id, report_date)
  DO UPDATE SET refreshed_at      = EXCLUDED.refreshed_at,
                views             = EXCLUDED.views,
                path_refreshed_at = EXCLUDED.path_refreshed_at;

  SELECT COALESCE(SUM(views), 0) INTO v_views FROM tmp_sum_src;
  DROP TABLE IF EXISTS tmp_sum_src;

  RETURN jsonb_build_object('ok', true, 'client_id', v_client, 'from', p_from, 'to', p_to,
                            'source_rows', v_rows, 'views', v_views);
END;
$function$;

-- Days whose per-page VDP rows are missing or older than the last GA4 re-sync.
CREATE OR REPLACE FUNCTION public.ga4_path_uncovered_days(p_client_id text, p_from date, p_to date)
 RETURNS date[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(array_agg(gs::date ORDER BY gs), '{}')
  FROM generate_series(p_from, p_to, interval '1 day') gs
  LEFT JOIN smart_sum_day_state s
    ON s.client_id = btrim(p_client_id) AND s.report_date = gs::date
  LEFT JOIN smart_ga4_day_complete c
    ON c.client_id = btrim(p_client_id) AND c.report_date = gs::date
  WHERE NOT EXISTS (SELECT 1 FROM smart_sum_pilot p WHERE p.client_id = btrim(p_client_id) AND p.enabled)
     OR s.path_refreshed_at IS NULL
     OR (c.completed_at IS NOT NULL AND c.completed_at > s.path_refreshed_at);
$function$;

CREATE OR REPLACE FUNCTION public.ga4_vdp_path_usable(p_client_id text, p_from date, p_to date)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_client_id IS NULL OR p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM smart_sum_pilot WHERE client_id = btrim(p_client_id) AND enabled) THEN
    RETURN false;
  END IF;
  RETURN COALESCE(array_length(public.ga4_path_uncovered_days(p_client_id, p_from, p_to), 1), 0) <= 7;
END;
$function$;

-- vdp_channel_matches(channel, list) re-keys the whole list on every row; pilot functions
-- compare channel_key against vdp_channel_keys(list) computed once instead.
CREATE OR REPLACE FUNCTION public.vdp_channel_keys(p_channels text[])
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT COALESCE(array_agg(public.vdp_channel_key(c)), '{}') FROM unnest(p_channels) AS c;
$function$;

-- Drop-in replacement for smart_ga4_page_data rows of one client/range (pilot dealers only):
-- VDP rows per page + channel, non-VDP rows per page type + channel, raw rows for uncovered days.
-- Plain SQL (no SECURITY DEFINER) so the planner inlines it into the calling function.
DROP FUNCTION IF EXISTS public.ga4_sum_page_rows(text, date, date);
CREATE OR REPLACE FUNCTION public.ga4_sum_page_rows(p_client_id text, p_from date, p_to date)
 RETURNS TABLE(client_id text, report_date date, ga4_property_id text, page_path text, page_path_q_s text,
               channel text, views bigint, vdp_conditions boolean, ga4_page_type text, channel_key text)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT v.client_id, v.report_date, v.ga4_property_id, v.page_path, v.page_path_q_s,
         v.channel, v.views, true, v.ga4_page_type, public.vdp_channel_key(v.channel)
  FROM public.smart_sum_ga4_vdp_path_daily v
  WHERE v.client_id = btrim(p_client_id)
    AND v.report_date BETWEEN p_from AND p_to
    AND NOT (v.report_date = ANY ((SELECT public.ga4_path_uncovered_days(p_client_id, p_from, p_to))::date[]))
  UNION ALL
  SELECT s.client_id, s.report_date, NULLIF(s.ga4_property_id, ''), NULL::text, NULL::text,
         NULLIF(s.channel, ''), s.views, false, NULLIF(s.ga4_page_type, ''),
         public.vdp_channel_key(NULLIF(s.channel, ''))
  FROM public.smart_sum_ga4_channel_daily s
  WHERE s.client_id = btrim(p_client_id)
    AND s.report_date BETWEEN p_from AND p_to
    AND NOT s.is_vdp
    AND NOT (s.report_date = ANY ((SELECT public.ga4_path_uncovered_days(p_client_id, p_from, p_to))::date[]))
  UNION ALL
  SELECT g.client_id, g.report_date, g.ga4_property_id, g.page_path, g.page_path_q_s,
         g.channel, COALESCE(g.views, 0)::bigint, g.vdp_conditions, g.ga4_page_type,
         public.vdp_channel_key(g.channel)
  FROM public.smart_ga4_page_data g
  WHERE g.client_id = btrim(p_client_id)
    AND g.report_date = ANY ((SELECT public.ga4_path_uncovered_days(p_client_id, p_from, p_to))::date[]);
$function$;

REVOKE ALL ON FUNCTION public.ga4_path_uncovered_days(text, date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga4_sum_page_rows(text, date, date)       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.vdp_channel_keys(text[])                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga4_vdp_path_usable(text, date, date)     FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ga4_vdp_path_usable(text, date, date) TO service_role;
