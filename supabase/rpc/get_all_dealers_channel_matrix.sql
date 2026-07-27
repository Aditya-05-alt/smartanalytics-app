-- All-dealer portfolio channel matrix (VDP / All tabs + date range).
-- Auto-selects grain for speed + previous-year coverage:
--   yearly  → mv_ga4_channel_yearly   (full calendar year / YTD)
--   monthly → mv_ga4_channel_monthly  (month-aligned or 60+ day ranges)
--   daily   → mv_ga4_channel_daily    (short / mid-month ranges)
-- Optional p_client_ids for chunked fetches.
-- Deploy in Supabase SQL editor AFTER mv_ga4_channel_monthly_yearly.sql
--
-- Prerequisite MVs:
--   mv_ga4_channel_daily
--   mv_ga4_channel_monthly
--   mv_ga4_channel_yearly
--
-- After GA4 sync / Step 2 filtration, refresh all three (see cron).

DROP FUNCTION IF EXISTS public.get_all_dealers_channel_matrix(date, date, text);
DROP FUNCTION IF EXISTS public.get_all_dealers_channel_matrix(date, date, text, text[]);

CREATE OR REPLACE FUNCTION public.get_all_dealers_channel_matrix(
  p_from       date,
  p_to         date,
  p_page_type  text DEFAULT 'ALL',
  p_client_ids text[] DEFAULT NULL
)
RETURNS TABLE (
  client_id      text,
  dealer_name    text,
  channel_bucket text,
  views          bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '55s'
AS $$
DECLARE
  v_page_type text := UPPER(COALESCE(p_page_type, 'ALL'));
  v_chunked   boolean := COALESCE(array_length(p_client_ids, 1), 0) > 0;
  v_grain     text;
  v_year_from int;
  v_year_to   int;
  v_year_end  date;
  v_month_from date;
  v_month_to   date;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RAISE EXCEPTION 'Invalid date range: % .. %', p_from, p_to;
  END IF;

  v_year_from := EXTRACT(YEAR FROM p_from)::int;
  v_year_to   := EXTRACT(YEAR FROM p_to)::int;
  v_year_end  := make_date(v_year_from, 12, 31);
  v_month_from := date_trunc('month', p_from)::date;
  v_month_to   := date_trunc('month', p_to)::date;

  -- Full calendar year, or YTD for the current year → yearly MV (fast + has history).
  IF v_year_from = v_year_to
     AND EXTRACT(MONTH FROM p_from)::int = 1
     AND EXTRACT(DAY FROM p_from)::int = 1
     AND (
       p_to = v_year_end
       OR (v_year_from = EXTRACT(YEAR FROM CURRENT_DATE)::int AND p_to <= CURRENT_DATE)
     )
  THEN
    v_grain := 'yearly';
  -- Month-aligned range (1st → last day of month) → monthly MV.
  ELSIF EXTRACT(DAY FROM p_from)::int = 1
     AND p_to = (v_month_to + INTERVAL '1 month' - INTERVAL '1 day')::date
  THEN
    v_grain := 'monthly';
  -- Long ranges (60+ days): use monthly months covering the span.
  ELSIF (p_to - p_from) >= 60 THEN
    v_grain := 'monthly';
  ELSE
    v_grain := 'daily';
  END IF;

  RETURN QUERY
  WITH dealers AS (
    SELECT DISTINCT ON (h.ga4_customer_id)
      h.ga4_customer_id::text AS dealer_client_id,
      h.customer_name         AS dealer_label
    FROM public.smart_hoot_config h
    WHERE h.is_active IS TRUE
      AND h.ga4_customer_id IS NOT NULL
      AND h.ga4_customer_id::text <> ''
      AND (
        NOT v_chunked
        OR h.ga4_customer_id::text = ANY (p_client_ids)
      )
    ORDER BY h.ga4_customer_id, h.id DESC
  ),
  base AS (
    SELECT
      y.client_id,
      y.channel,
      y.ga4_page_type,
      y.views
    FROM public.mv_ga4_channel_yearly y
    WHERE v_grain = 'yearly'
      AND y.report_year = v_year_from
      AND (
        NOT v_chunked
        OR y.client_id = ANY (p_client_ids)
      )

    UNION ALL

    SELECT
      m.client_id,
      m.channel,
      m.ga4_page_type,
      m.views
    FROM public.mv_ga4_channel_monthly m
    WHERE v_grain = 'monthly'
      AND m.month_start BETWEEN v_month_from AND v_month_to
      AND (
        NOT v_chunked
        OR m.client_id = ANY (p_client_ids)
      )

    UNION ALL

    SELECT
      d.client_id,
      d.channel,
      d.ga4_page_type,
      d.views
    FROM public.mv_ga4_channel_daily d
    WHERE v_grain = 'daily'
      AND d.report_date BETWEEN p_from AND p_to
      AND (
        NOT v_chunked
        OR d.client_id = ANY (p_client_ids)
      )
  ),
  pages AS (
    SELECT
      b.client_id AS dealer_client_id,
      b.channel   AS raw_channel,
      SUM(COALESCE(b.views, 0))::bigint AS page_views
    FROM base b
    WHERE
      v_page_type = 'ALL'
      OR (v_page_type = 'VDP' AND b.ga4_page_type LIKE 'VDP%')
      OR (v_page_type = 'SRP' AND b.ga4_page_type = 'SRP')
      OR (v_page_type IN ('HOME', 'HOMEPAGE') AND b.ga4_page_type ILIKE 'home%')
      OR (
        v_page_type = 'OTHER'
        AND b.ga4_page_type NOT LIKE 'VDP%'
        AND b.ga4_page_type <> 'SRP'
        AND b.ga4_page_type NOT ILIKE 'home%'
      )
    GROUP BY b.client_id, b.channel
  ),
  normalized AS (
    SELECT
      pg.dealer_client_id,
      CASE lower(trim(COALESCE(pg.raw_channel, '')))
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
        ELSE initcap(replace(replace(lower(trim(pg.raw_channel)), '_', ' '), '-', ' '))
      END AS norm_channel,
      pg.page_views
    FROM pages pg
  ),
  rolled AS (
    SELECT
      n.dealer_client_id,
      CASE
        WHEN n.norm_channel IN (
          'Paid Search', 'Cross-network', 'Cross Network', 'Display'
        ) THEN 'Paid Search + Cross Network + Display'
        WHEN n.norm_channel IN ('Paid Social', 'Organic Social')
        THEN 'Paid Social + Organic Social'
        ELSE n.norm_channel
      END AS rolled_channel,
      SUM(n.page_views)::bigint AS channel_views
    FROM normalized n
    GROUP BY n.dealer_client_id, 2
  )
  SELECT
    r.dealer_client_id,
    d.dealer_label,
    r.rolled_channel,
    r.channel_views
  FROM rolled r
  INNER JOIN dealers d ON d.dealer_client_id = r.dealer_client_id
  WHERE r.channel_views > 0
  ORDER BY d.dealer_label, r.channel_views DESC, r.rolled_channel;
END;
$$;

REVOKE ALL ON FUNCTION public.get_all_dealers_channel_matrix(date, date, text, text[])
  FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_all_dealers_channel_matrix(date, date, text, text[])
  TO anon, authenticated, service_role;

-- After page sync or VDP filtration:
-- REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_ga4_channel_daily;
-- REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_ga4_channel_monthly;
-- REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_ga4_channel_yearly;
