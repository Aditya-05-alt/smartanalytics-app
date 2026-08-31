-- VDP Lab: dealer compare GA4 (vdp_conditions) vs full BigQ VDP
-- Join: ga4_property_id = profile_id::text
-- Includes BigQ-only profiles (missing from report) with names from page_title ("at Dealer |").
-- Caps p_to to CURRENT_DATE - 2.
--
-- Perf: no full-table MODE()/regexp over all BigQ titles; no smart_final_data scan.
-- Prefer partial index idx_ga4_page_vdp_date_prop for GA4 CTE.

DROP FUNCTION IF EXISTS public.compare_vdp_ga4_vs_bigq(text, date, date);
DROP FUNCTION IF EXISTS public.compare_vdp_ga4_vs_bigq(date, date);

CREATE OR REPLACE FUNCTION public.compare_vdp_ga4_vs_bigq(
  p_from date DEFAULT NULL,
  p_to   date DEFAULT NULL
)
RETURNS TABLE (
  client_id       text,
  account_name    text,
  property_id     text,
  ga4_vdp_views   bigint,
  bigq_vdp_views  bigint,
  delta_views     bigint,
  delta_pct       numeric,
  match_status    text,
  on_report       boolean,
  range_from      date,
  range_to        date
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '90s'
AS $$
DECLARE
  v_from date;
  v_to   date;
  v_cap  date := (CURRENT_DATE - 2);
BEGIN
  v_to := LEAST(COALESCE(p_to, v_cap), v_cap);
  v_from := COALESCE(p_from, v_to - 6);
  IF v_from > v_to THEN
    v_from := v_to;
  END IF;

  RETURN QUERY
  WITH cfg AS (
    SELECT DISTINCT ON (NULLIF(btrim(c.ga4_property_id::text), ''))
      NULLIF(btrim(c.ga4_property_id::text), '') AS pid,
      c.client_id::text AS cid,
      COALESCE(
        NULLIF(btrim(c.account_name), ''),
        NULLIF(btrim(h.customer_name), '')
      ) AS aname
    FROM public.smart_ga4_config c
    LEFT JOIN LATERAL (
      SELECT h0.customer_name
      FROM public.smart_hoot_config h0
      WHERE h0.ga4_customer_id::text = c.client_id::text
      ORDER BY h0.id DESC
      LIMIT 1
    ) h ON true
    WHERE c.ga4_property_id IS NOT NULL
      AND btrim(c.ga4_property_id::text) <> ''
      AND COALESCE(c.is_active, true) IS TRUE
    ORDER BY NULLIF(btrim(c.ga4_property_id::text), ''), c.id DESC
  ),
  ga4 AS (
    SELECT
      NULLIF(btrim(g.ga4_property_id::text), '') AS pid,
      COALESCE(SUM(g.views), 0)::bigint AS views
    FROM public.smart_ga4_page_data g
    WHERE g.report_date BETWEEN v_from AND v_to
      AND g.vdp_conditions IS TRUE
      AND NULLIF(btrim(g.ga4_property_id::text), '') IS NOT NULL
    GROUP BY NULLIF(btrim(g.ga4_property_id::text), '')
  ),
  bigq AS (
    SELECT
      b.profile_id::text AS pid,
      MAX(b.dealer_id)::text AS bigq_dealer_id,
      COALESCE(SUM(b.page_views), 0)::bigint AS views
    FROM public.smart_ga4_bigq_daily_raw_data b
    WHERE b.date BETWEEN v_from AND v_to
      AND b.profile_id IS NOT NULL
    GROUP BY b.profile_id::text
  ),
  -- Name guess only for BigQ profiles not in smart_ga4_config (1 title sample each)
  bigq_names AS (
    SELECT
      m.pid,
      n.guessed_name
    FROM (
      SELECT bq.pid
      FROM bigq bq
      WHERE NOT EXISTS (SELECT 1 FROM cfg c WHERE c.pid = bq.pid)
    ) m
    LEFT JOIN LATERAL (
      SELECT
        NULLIF(
          btrim((regexp_match(b.page_title, ' at ([^|]+)\|', 'i'))[1]),
          ''
        ) AS guessed_name
      FROM public.smart_ga4_bigq_daily_raw_data b
      WHERE b.profile_id::text = m.pid
        AND b.date BETWEEN v_from AND v_to
        AND b.page_title IS NOT NULL
        AND b.page_title ~* ' at [^|]+\|'
      LIMIT 1
    ) n ON true
  ),
  keys AS (
    SELECT pid FROM cfg
    UNION
    SELECT pid FROM ga4
    UNION
    SELECT pid FROM bigq
  )
  SELECT
    COALESCE(cfg.cid, bigq.bigq_dealer_id)::text AS client_id,
    COALESCE(
      cfg.aname,
      bigq_names.guessed_name,
      CASE
        WHEN bigq.pid IS NOT NULL THEN 'Unmapped BigQ · ' || keys.pid
        ELSE 'Unknown · ' || keys.pid
      END
    )::text AS account_name,
    keys.pid::text AS property_id,
    COALESCE(ga4.views, 0)::bigint AS ga4_vdp_views,
    COALESCE(bigq.views, 0)::bigint AS bigq_vdp_views,
    (COALESCE(bigq.views, 0) - COALESCE(ga4.views, 0))::bigint AS delta_views,
    CASE
      WHEN COALESCE(ga4.views, 0) = 0 AND COALESCE(bigq.views, 0) = 0 THEN 0::numeric
      WHEN COALESCE(ga4.views, 0) = 0 THEN NULL
      ELSE ROUND(
        100.0 * (COALESCE(bigq.views, 0) - COALESCE(ga4.views, 0))
          / ga4.views::numeric,
        2
      )
    END AS delta_pct,
    CASE
      WHEN cfg.pid IS NOT NULL AND COALESCE(bigq.views, 0) > 0 AND COALESCE(ga4.views, 0) > 0
        THEN 'matched'
      WHEN cfg.pid IS NULL AND COALESCE(bigq.views, 0) > 0
        THEN 'missing_from_report'
      WHEN COALESCE(bigq.views, 0) = 0 AND COALESCE(ga4.views, 0) > 0
        THEN 'ga4_only'
      WHEN COALESCE(ga4.views, 0) = 0 AND COALESCE(bigq.views, 0) > 0
        THEN 'bigq_only'
      ELSE 'other'
    END::text AS match_status,
    (cfg.pid IS NOT NULL) AS on_report,
    v_from AS range_from,
    v_to AS range_to
  FROM keys
  LEFT JOIN cfg ON cfg.pid = keys.pid
  LEFT JOIN ga4 ON ga4.pid = keys.pid
  LEFT JOIN bigq ON bigq.pid = keys.pid
  LEFT JOIN bigq_names ON bigq_names.pid = keys.pid
  WHERE COALESCE(ga4.views, 0) > 0
     OR COALESCE(bigq.views, 0) > 0
  ORDER BY
    CASE
      WHEN cfg.pid IS NULL AND COALESCE(bigq.views, 0) > 0 THEN 0
      WHEN COALESCE(bigq.views, 0) = 0 AND COALESCE(ga4.views, 0) > 0 THEN 1
      ELSE 2
    END,
    ABS(COALESCE(bigq.views, 0) - COALESCE(ga4.views, 0)) DESC,
    COALESCE(bigq.views, 0) DESC;
END;
$$;

COMMENT ON FUNCTION public.compare_vdp_ga4_vs_bigq(date, date) IS
  'VDP Lab: GA4 vdp_conditions vs full BigQ VDP by profile_id=ga4_property_id. Flags dealers missing from report; names BigQ-only via page_title sample.';

REVOKE ALL ON FUNCTION public.compare_vdp_ga4_vs_bigq(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.compare_vdp_ga4_vs_bigq(date, date)
  TO anon, authenticated, service_role;
