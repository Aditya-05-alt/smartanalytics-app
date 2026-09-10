-- All-dealer portfolio channel matrix (VDP / All tabs + date range).
--
-- VDP monthly: ga4_vdp_channel_monthly (vdp_conditions aggregates — KPI-aligned, fast)
-- VDP other grains: live smart_ga4_page_data + vdp_conditions (chunked by API)
-- Other page types: MATERIALIZED VIEWS (yearly / monthly / daily) with live fallback.
--
-- Optional p_client_ids for chunked fetches.

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
  v_month_last date;
  v_daily_max  date;
  v_vdp_months_ready boolean := false;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RAISE EXCEPTION 'Invalid date range: % .. %', p_from, p_to;
  END IF;

  v_year_from := EXTRACT(YEAR FROM p_from)::int;
  v_year_to   := EXTRACT(YEAR FROM p_to)::int;
  v_year_end  := make_date(v_year_from, 12, 31);
  v_month_from := date_trunc('month', p_from)::date;
  v_month_to   := date_trunc('month', p_to)::date;
  v_month_last := (v_month_to + INTERVAL '1 month' - INTERVAL '1 day')::date;

  IF v_year_from = v_year_to
     AND EXTRACT(MONTH FROM p_from)::int = 1
     AND EXTRACT(DAY FROM p_from)::int = 1
     AND p_to = v_year_end
  THEN
    v_grain := 'yearly';

  ELSIF EXTRACT(DAY FROM p_from)::int = 1
     AND p_to = v_month_last
  THEN
    v_grain := 'monthly';

  ELSIF (p_to - p_from) >= 60 THEN
    v_grain := 'monthly';

  ELSE
    v_grain := 'daily';
  END IF;

  -- VDP: prefer pre-agg monthly table for full months AND same-month MTD
  -- (Current Month). Refresh ga4_vdp_channel_monthly after GA4 sync.
  IF v_page_type = 'VDP'
     AND EXTRACT(DAY FROM p_from)::int = 1
     AND v_month_from = v_month_to
  THEN
    SELECT EXISTS (
      SELECT 1 FROM public.ga4_vdp_channel_monthly g
      WHERE g.month_start = v_month_from
    ) INTO v_vdp_months_ready;

    IF COALESCE(v_vdp_months_ready, false) THEN
      v_grain := 'vdp_monthly_agg';
    ELSE
      v_grain := 'vdp_live';
    END IF;

  ELSIF v_page_type = 'VDP' AND v_grain = 'monthly' THEN
    SELECT bool_and(EXISTS (
      SELECT 1 FROM public.ga4_vdp_channel_monthly g
      WHERE g.month_start = m
    ))
    INTO v_vdp_months_ready
    FROM generate_series(v_month_from, v_month_to, INTERVAL '1 month') AS s(m);

    IF COALESCE(v_vdp_months_ready, false) THEN
      v_grain := 'vdp_monthly_agg';
    ELSE
      v_grain := 'vdp_live';
    END IF;

  ELSIF v_page_type = 'VDP' THEN
    -- Other custom ranges: live vdp_conditions (API chunks this)
    v_grain := 'vdp_live';

  ELSIF v_grain = 'daily' THEN
    SELECT MAX(d.report_date) INTO v_daily_max FROM public.mv_ga4_channel_daily d;
    IF v_daily_max IS NULL OR v_daily_max < p_from THEN
      v_grain := 'live';
    END IF;
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
    -- Fast VDP full-month aggregate (vdp_conditions)
    SELECT
      g.client_id,
      g.channel,
      'VDP'::text AS ga4_page_type,
      g.views
    FROM public.ga4_vdp_channel_monthly g
    WHERE v_grain = 'vdp_monthly_agg'
      AND g.month_start BETWEEN v_month_from AND v_month_to
      AND (
        NOT v_chunked
        OR g.client_id = ANY (p_client_ids)
      )

    UNION ALL

    -- Live VDP (KPI-aligned) for MTD / missing months
    SELECT
      p.client_id,
      p.channel,
      'VDP'::text,
      SUM(COALESCE(p.views, 0))::bigint AS views
    FROM public.smart_ga4_page_data p
    WHERE v_grain = 'vdp_live'
      AND p.report_date BETWEEN p_from AND p_to
      AND p.vdp_conditions IS TRUE
      AND (
        NOT v_chunked
        OR p.client_id = ANY (p_client_ids)
      )
    GROUP BY p.client_id, p.channel

    UNION ALL

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
      AND d.report_date BETWEEN p_from AND LEAST(p_to, COALESCE(v_daily_max, p_to))
      AND (
        NOT v_chunked
        OR d.client_id = ANY (p_client_ids)
      )

    UNION ALL

    SELECT
      p.client_id,
      p.channel,
      p.ga4_page_type,
      SUM(COALESCE(p.views, 0))::bigint AS views
    FROM public.smart_ga4_page_data p
    WHERE v_grain = 'live'
      AND p.report_date BETWEEN p_from AND p_to
      AND (
        NOT v_chunked
        OR p.client_id = ANY (p_client_ids)
      )
    GROUP BY p.client_id, p.channel, p.ga4_page_type
  ),
  pages AS (
    SELECT
      b.client_id AS dealer_client_id,
      b.channel   AS raw_channel,
      SUM(COALESCE(b.views, 0))::bigint AS page_views
    FROM base b
    WHERE
      v_page_type = 'ALL'
      OR v_page_type = 'VDP'
      OR (v_page_type = 'SRP' AND b.ga4_page_type = 'SRP')
      OR (v_page_type IN ('HOME', 'HOMEPAGE') AND b.ga4_page_type ILIKE 'home%')
      OR (
        v_page_type = 'OTHER'
        AND b.ga4_page_type NOT ILIKE 'VDP%'
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
  )
  SELECT
    n.dealer_client_id,
    d.dealer_label,
    n.norm_channel,
    SUM(n.page_views)::bigint AS channel_views
  FROM normalized n
  INNER JOIN dealers d ON d.dealer_client_id = n.dealer_client_id
  GROUP BY n.dealer_client_id, d.dealer_label, n.norm_channel
  HAVING SUM(n.page_views) > 0
  ORDER BY d.dealer_label, channel_views DESC, n.norm_channel;
END;
$$;

REVOKE ALL ON FUNCTION public.get_all_dealers_channel_matrix(date, date, text, text[])
  FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_all_dealers_channel_matrix(date, date, text, text[])
  TO anon, authenticated, service_role;
