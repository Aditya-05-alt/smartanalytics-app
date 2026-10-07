-- GA4 daily summary pilot (A&L only).
-- Pre-aggregated per-day GA4 totals so the dashboard overview / channel breakdown
-- read a few hundred rows instead of scanning smart_ga4_page_data.
-- Only clients listed in smart_sum_pilot are summarised; all other dealers are untouched.

CREATE TABLE IF NOT EXISTS public.smart_sum_pilot (
  client_id       text PRIMARY KEY,
  enabled         boolean NOT NULL DEFAULT true,
  backfill_from   date NOT NULL,
  backfill_cursor date,
  created_at      timestamptz NOT NULL DEFAULT now(),
  notes           text
);

CREATE TABLE IF NOT EXISTS public.smart_sum_ga4_channel_daily (
  client_id       text    NOT NULL,
  report_date     date    NOT NULL,
  ga4_property_id text    NOT NULL DEFAULT '',
  ga4_page_type   text    NOT NULL DEFAULT '',
  is_vdp          boolean NOT NULL,
  channel         text    NOT NULL DEFAULT '',
  views           bigint  NOT NULL,
  PRIMARY KEY (client_id, report_date, ga4_property_id, ga4_page_type, is_vdp, channel)
);

-- ga4_property_id = '*' rows hold distinct-page counts across all properties.
CREATE TABLE IF NOT EXISTS public.smart_sum_ga4_overview_daily (
  client_id       text   NOT NULL,
  report_date     date   NOT NULL,
  ga4_property_id text   NOT NULL,
  ga4_page_type   text   NOT NULL DEFAULT '',
  views           bigint NOT NULL,
  unique_pages    bigint NOT NULL,
  PRIMARY KEY (client_id, report_date, ga4_property_id, ga4_page_type)
);

CREATE TABLE IF NOT EXISTS public.smart_sum_day_state (
  client_id    text        NOT NULL,
  report_date  date        NOT NULL,
  refreshed_at timestamptz NOT NULL,
  views        bigint      NOT NULL DEFAULT 0,
  PRIMARY KEY (client_id, report_date)
);

CREATE TABLE IF NOT EXISTS public.smart_sum_check_log (
  id          bigserial PRIMARY KEY,
  run_at      timestamptz NOT NULL DEFAULT now(),
  client_id   text   NOT NULL,
  report_date date   NOT NULL,
  raw_views   bigint NOT NULL,
  sum_views   bigint NOT NULL,
  ok          boolean NOT NULL,
  repaired    boolean NOT NULL DEFAULT false
);

ALTER TABLE public.smart_sum_pilot              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.smart_sum_ga4_channel_daily  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.smart_sum_ga4_overview_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.smart_sum_day_state          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.smart_sum_check_log          ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Rebuild summary rows for one client and date range from smart_ga4_page_data.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_ga4_summary_range(p_client_id text, p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '10min'
AS $function$
DECLARE
  v_client text := btrim(p_client_id);
  v_rows   bigint;
  v_views  bigint;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad range');
  END IF;

  DROP TABLE IF EXISTS tmp_sum_src;
  CREATE TEMP TABLE tmp_sum_src ON COMMIT DROP AS
  SELECT p.report_date,
         COALESCE(NULLIF(btrim(p.ga4_property_id), ''), '') AS prop,
         COALESCE(p.ga4_page_type, '')                      AS page_type,
         (p.vdp_conditions IS TRUE)                          AS is_vdp,
         COALESCE(p.channel, '')                             AS channel,
         p.page_path,
         COALESCE(p.views, 0)::bigint                        AS views
  FROM smart_ga4_page_data p
  WHERE p.client_id = v_client
    AND p.report_date BETWEEN p_from AND p_to;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  DELETE FROM smart_sum_ga4_channel_daily  WHERE client_id = v_client AND report_date BETWEEN p_from AND p_to;
  DELETE FROM smart_sum_ga4_overview_daily WHERE client_id = v_client AND report_date BETWEEN p_from AND p_to;

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

  INSERT INTO smart_sum_day_state (client_id, report_date, refreshed_at, views)
  SELECT v_client, d::date, now(),
         COALESCE((SELECT SUM(s.views) FROM tmp_sum_src s WHERE s.report_date = d::date), 0)
  FROM generate_series(p_from, p_to, interval '1 day') d
  ON CONFLICT (client_id, report_date)
  DO UPDATE SET refreshed_at = EXCLUDED.refreshed_at, views = EXCLUDED.views;

  SELECT COALESCE(SUM(views), 0) INTO v_views FROM tmp_sum_src;
  DROP TABLE IF EXISTS tmp_sum_src;

  RETURN jsonb_build_object('ok', true, 'client_id', v_client, 'from', p_from, 'to', p_to,
                            'source_rows', v_rows, 'views', v_views);
END;
$function$;

-- ---------------------------------------------------------------------------
-- Backfill: walks each pilot client's history newest-first, p_days per call.
-- Unschedules its own cron job once every pilot client is fully backfilled.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ga4_summary_backfill_step(p_days integer DEFAULT 10)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '10min'
AS $function$
DECLARE
  r       record;
  v_from  date;
  v_done  jsonb := '[]'::jsonb;
BEGIN
  FOR r IN
    SELECT client_id, backfill_from, backfill_cursor
    FROM smart_sum_pilot
    WHERE enabled AND backfill_cursor IS NOT NULL
  LOOP
    v_from := GREATEST(r.backfill_cursor - (GREATEST(p_days, 1) - 1), r.backfill_from);
    PERFORM refresh_ga4_summary_range(r.client_id, v_from, r.backfill_cursor);
    UPDATE smart_sum_pilot
       SET backfill_cursor = CASE WHEN v_from <= backfill_from THEN NULL ELSE v_from - 1 END
     WHERE client_id = r.client_id;
    v_done := v_done || jsonb_build_object('client_id', r.client_id, 'from', v_from, 'to', r.backfill_cursor);
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM smart_sum_pilot WHERE enabled AND backfill_cursor IS NOT NULL)
     AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ga4-summary-backfill') THEN
    PERFORM cron.unschedule('ga4-summary-backfill');
  END IF;

  RETURN jsonb_build_object('ok', true, 'processed', v_done);
END;
$function$;

-- ---------------------------------------------------------------------------
-- Nightly: refresh the last p_days days plus any day GA4 re-synced after its
-- last summary refresh.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ga4_summary_nightly(p_days integer DEFAULT 7)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '20min'
AS $function$
DECLARE
  r      record;
  d      record;
  v_today date := (now() AT TIME ZONE 'utc')::date;
  v_out  jsonb := '[]'::jsonb;
  v_n    int;
BEGIN
  FOR r IN SELECT client_id FROM smart_sum_pilot WHERE enabled LOOP
    PERFORM refresh_ga4_summary_range(r.client_id, v_today - GREATEST(p_days, 1), v_today);
    v_n := 0;
    FOR d IN
      SELECT c.report_date
      FROM smart_ga4_day_complete c
      LEFT JOIN smart_sum_day_state s
        ON s.client_id = c.client_id AND s.report_date = c.report_date
      WHERE c.client_id = r.client_id
        AND c.report_date < v_today - GREATEST(p_days, 1)
        AND (s.refreshed_at IS NULL OR c.completed_at > s.refreshed_at)
      ORDER BY c.report_date
    LOOP
      PERFORM refresh_ga4_summary_range(r.client_id, d.report_date, d.report_date);
      v_n := v_n + 1;
    END LOOP;
    v_out := v_out || jsonb_build_object('client_id', r.client_id, 'resynced_older_days', v_n);
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'clients', v_out);
END;
$function$;

-- ---------------------------------------------------------------------------
-- Daily check: compare summary vs raw for the last p_days days, log the result
-- and rebuild any day that does not match.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ga4_summary_check(p_days integer DEFAULT 7)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '20min'
AS $function$
DECLARE
  r       record;
  v_today date := (now() AT TIME ZONE 'utc')::date;
  v_bad   int := 0;
  v_total int := 0;
BEGIN
  FOR r IN
    WITH days AS (
      SELECT p.client_id, gs::date AS report_date
      FROM smart_sum_pilot p
      CROSS JOIN generate_series(v_today - GREATEST(p_days, 1), v_today - 1, interval '1 day') gs
      WHERE p.enabled
    ),
    raw AS (
      SELECT d.client_id, d.report_date,
             COALESCE((SELECT SUM(COALESCE(g.views, 0)) FROM smart_ga4_page_data g
                       WHERE g.client_id = d.client_id AND g.report_date = d.report_date), 0)::bigint AS raw_views
      FROM days d
    ),
    summ AS (
      SELECT d.client_id, d.report_date,
             COALESCE((SELECT SUM(s.views) FROM smart_sum_ga4_channel_daily s
                       WHERE s.client_id = d.client_id AND s.report_date = d.report_date), 0)::bigint AS sum_views
      FROM days d
    )
    SELECT raw.client_id, raw.report_date, raw.raw_views, summ.sum_views
    FROM raw JOIN summ USING (client_id, report_date)
  LOOP
    v_total := v_total + 1;
    IF r.raw_views <> r.sum_views THEN
      v_bad := v_bad + 1;
      PERFORM refresh_ga4_summary_range(r.client_id, r.report_date, r.report_date);
    END IF;
    INSERT INTO smart_sum_check_log (client_id, report_date, raw_views, sum_views, ok, repaired)
    VALUES (r.client_id, r.report_date, r.raw_views, r.sum_views,
            r.raw_views = r.sum_views, r.raw_views <> r.sum_views);
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'days_checked', v_total, 'mismatched_and_repaired', v_bad);
END;
$function$;

-- ---------------------------------------------------------------------------
-- Coverage: how many days in the range the summary can serve. A day is served
-- from the summary only if it was refreshed after GA4 last completed it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ga4_summary_uncovered_days(p_client_id text, p_from date, p_to date)
RETURNS date[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(array_agg(gs::date ORDER BY gs), '{}')
  FROM generate_series(p_from, p_to, interval '1 day') gs
  LEFT JOIN smart_sum_day_state s
    ON s.client_id = btrim(p_client_id) AND s.report_date = gs::date
  LEFT JOIN smart_ga4_day_complete c
    ON c.client_id = btrim(p_client_id) AND c.report_date = gs::date
  WHERE NOT EXISTS (SELECT 1 FROM smart_sum_pilot p WHERE p.client_id = btrim(p_client_id) AND p.enabled)
     OR s.refreshed_at IS NULL
     OR (c.completed_at IS NOT NULL AND c.completed_at > s.refreshed_at);
$function$;

CREATE OR REPLACE FUNCTION public.get_ga4_summary_coverage(p_client_id text, p_from date, p_to date)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'enabled', EXISTS (SELECT 1 FROM smart_sum_pilot p WHERE p.client_id = btrim(p_client_id) AND p.enabled),
    'total_days', (p_to - p_from) + 1,
    'uncovered_days', COALESCE(array_length(public.ga4_summary_uncovered_days(p_client_id, p_from, p_to), 1), 0)
  );
$function$;

-- ---------------------------------------------------------------------------
-- Readers: same output shape as get_ga4_overview / get_ga4_channel_breakdown
-- (unfiltered path). Covered days come from the summary, the rest from raw.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_ga4_overview_summary(
  p_client_id text, p_from date, p_to date, p_ga4_property_id text DEFAULT NULL
)
RETURNS TABLE(report_date date, ga4_page_type text, views bigint, unique_pages bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '55s'
AS $function$
DECLARE
  v_client  text := btrim(p_client_id);
  v_prop    text := COALESCE(NULLIF(btrim(p_ga4_property_id), ''), '');
  v_missing date[] := public.ga4_summary_uncovered_days(p_client_id, p_from, p_to);
BEGIN
  RETURN QUERY
  SELECT s.report_date, NULLIF(s.ga4_page_type, ''), s.views, s.unique_pages
  FROM smart_sum_ga4_overview_daily s
  WHERE s.client_id = v_client
    AND s.report_date BETWEEN p_from AND p_to
    AND NOT (s.report_date = ANY (v_missing))
    AND s.ga4_property_id = CASE WHEN v_prop = '' THEN '*' ELSE v_prop END
  UNION ALL
  SELECT g.report_date, g.ga4_page_type, SUM(g.views)::bigint, COUNT(DISTINCT g.page_path)::bigint
  FROM smart_ga4_page_data g
  WHERE g.client_id = v_client
    AND g.report_date = ANY (v_missing)
    AND public.ga4_property_scope_matches(g.ga4_property_id, p_ga4_property_id)
  GROUP BY g.report_date, g.ga4_page_type
  ORDER BY 1, 2;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_ga4_channel_breakdown_summary(
  p_client_id text, p_from date, p_to date,
  p_page_type text DEFAULT 'ALL', p_channels text[] DEFAULT NULL, p_ga4_property_id text DEFAULT NULL
)
RETURNS TABLE(channel_bucket text, views bigint, pct numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '55s'
AS $function$
DECLARE
  v_client    text := btrim(p_client_id);
  v_page_type text := UPPER(COALESCE(p_page_type, 'ALL'));
  v_missing   date[] := public.ga4_summary_uncovered_days(p_client_id, p_from, p_to);
BEGIN
  RETURN QUERY
  WITH base AS (
    SELECT s.channel, s.ga4_page_type AS page_type, s.is_vdp, s.views
    FROM smart_sum_ga4_channel_daily s
    WHERE s.client_id = v_client
      AND s.report_date BETWEEN p_from AND p_to
      AND NOT (s.report_date = ANY (v_missing))
      AND public.ga4_property_scope_matches(NULLIF(s.ga4_property_id, ''), p_ga4_property_id)
    UNION ALL
    SELECT COALESCE(g.channel, ''), COALESCE(g.ga4_page_type, ''), (g.vdp_conditions IS TRUE), COALESCE(g.views, 0)::bigint
    FROM smart_ga4_page_data g
    WHERE g.client_id = v_client
      AND g.report_date = ANY (v_missing)
      AND public.ga4_property_scope_matches(g.ga4_property_id, p_ga4_property_id)
  ),
  scoped AS (
    SELECT b.channel, b.views
    FROM base b
    WHERE (
        v_page_type = 'ALL'
        OR (v_page_type = 'VDP'   AND b.is_vdp)
        OR (v_page_type = 'SRP'   AND b.page_type = 'SRP')
        OR (v_page_type = 'HOME'  AND b.page_type ILIKE 'home%')
        OR (v_page_type = 'OTHER' AND NOT b.is_vdp
                                  AND b.page_type <> 'SRP'
                                  AND b.page_type NOT ILIKE 'home%')
      )
      AND (p_channels IS NULL OR array_length(p_channels, 1) = 0
           OR public.vdp_channel_matches(NULLIF(b.channel, ''), p_channels))
  ),
  mapped AS (
    SELECT
      CASE lower(trim(sc.channel))
        WHEN 'organic_search'  THEN 'Organic Search'
        WHEN 'paid_search'     THEN 'Paid Search'
        WHEN 'direct'          THEN 'Direct'
        WHEN 'organic_social'  THEN 'Organic Social'
        WHEN 'paid_social'     THEN 'Paid Social'
        WHEN 'paid_video'      THEN 'Paid Video'
        WHEN 'organic_video'   THEN 'Organic Video'
        WHEN 'display'         THEN 'Display'
        WHEN 'email'           THEN 'Email'
        WHEN 'referral'        THEN 'Referral'
        WHEN 'affiliates'      THEN 'Affiliates'
        WHEN 'paid_other'      THEN 'Paid Other'
        WHEN 'sms'             THEN 'SMS'
        WHEN 'audio'           THEN 'Audio'
        WHEN 'cross-network'   THEN 'Cross-network'
        WHEN 'unassigned'      THEN 'Unassigned'
        WHEN ''                THEN '(not set)'
        ELSE initcap(replace(replace(lower(trim(sc.channel)), '_', ' '), '-', ' '))
      END AS channel_bucket,
      sc.views
    FROM scoped sc
  ),
  agg AS (
    SELECT m.channel_bucket, SUM(m.views)::bigint AS views FROM mapped m GROUP BY m.channel_bucket
  ),
  grand AS (
    SELECT NULLIF(SUM(a.views), 0)::numeric AS total FROM agg a
  )
  SELECT a.channel_bucket, a.views, ROUND(100.0 * a.views / g.total, 2)
  FROM agg a CROSS JOIN grand g
  WHERE a.views > 0
  ORDER BY a.views DESC, a.channel_bucket;
END;
$function$;

REVOKE ALL ON FUNCTION public.refresh_ga4_summary_range(text, date, date)              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga4_summary_backfill_step(integer)                       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga4_summary_nightly(integer)                             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga4_summary_check(integer)                               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga4_summary_uncovered_days(text, date, date)             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_ga4_summary_coverage(text, date, date)               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_ga4_overview_summary(text, date, date, text)         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_ga4_channel_breakdown_summary(text, date, date, text, text[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_ga4_summary_range(text, date, date)              TO service_role;
GRANT EXECUTE ON FUNCTION public.ga4_summary_backfill_step(integer)                       TO service_role;
GRANT EXECUTE ON FUNCTION public.ga4_summary_nightly(integer)                             TO service_role;
GRANT EXECUTE ON FUNCTION public.ga4_summary_check(integer)                               TO service_role;
GRANT EXECUTE ON FUNCTION public.ga4_summary_uncovered_days(text, date, date)             TO service_role;
GRANT EXECUTE ON FUNCTION public.get_ga4_summary_coverage(text, date, date)               TO service_role;
GRANT EXECUTE ON FUNCTION public.get_ga4_overview_summary(text, date, date, text)         TO service_role;
GRANT EXECUTE ON FUNCTION public.get_ga4_channel_breakdown_summary(text, date, date, text, text[], text) TO service_role;

-- Pilot: A&L RV Sales only, full history (first GA4 day 2023-01-01).
INSERT INTO public.smart_sum_pilot (client_id, backfill_from, backfill_cursor, notes)
VALUES ('2728830488', '2023-01-01', ((now() AT TIME ZONE 'utc')::date - 1), 'A&L RV Sales pilot')
ON CONFLICT (client_id) DO NOTHING;
