-- VDP Analysis "All dealers" view: per-dealer stats for every dealer with data in smart_vdp_* tables,
-- for all units and New / Used separately, plus an all-dealer total ('ALL').
-- Stats match the page's getStats(): inStock = unit-days in feed / snapshot days; perUnit = in-stock views /
-- inStock; median = sorted views[floor(n/2)]; topShare = share of views on the top ceil(n*0.2) units;
-- dependent = units with 10+ views and 70%+ from one channel.

CREATE OR REPLACE FUNCTION public.get_vdp_analysis_summary(p_from date, p_to date, p_client_ids text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '25s'
AS $function$
  WITH inv AS (
    SELECT client_id, uk, count(*) AS days_listed,
           (array_agg(condition ORDER BY d DESC) FILTER (WHERE NULLIF(btrim(condition), '') IS NOT NULL))[1] AS cond,
           (array_agg(url ORDER BY d DESC))[1] AS url
    FROM smart_vdp_inventory_daily
    WHERE d BETWEEN p_from AND p_to
      AND (p_client_ids IS NULL OR client_id = ANY (p_client_ids))
    GROUP BY 1, 2
  ),
  snap_days AS (
    SELECT client_id, count(DISTINCT d) AS days
    FROM smart_vdp_inventory_daily
    WHERE d BETWEEN p_from AND p_to
      AND (p_client_ids IS NULL OR client_id = ANY (p_client_ids))
    GROUP BY 1
  ),
  views_rng AS (
    SELECT client_id, uk, channel, views, in_stock, inv_condition
    FROM smart_vdp_unit_views_daily
    WHERE report_date BETWEEN p_from AND p_to
      AND (p_client_ids IS NULL OR client_id = ANY (p_client_ids))
  ),
  unit_channel AS (
    SELECT client_id, uk, channel, round(SUM(views)) AS v
    FROM views_rng
    WHERE in_stock
    GROUP BY 1, 2, 3
    HAVING round(SUM(views)) > 0
  ),
  unit_totals AS (
    SELECT client_id, uk, SUM(v) AS views, max(v) AS max_v FROM unit_channel GROUP BY 1, 2
  ),
  fin_condition AS (
    SELECT client_id, uk, max(inv_condition) AS c FROM views_rng WHERE uk <> '' GROUP BY 1, 2
  ),
  units AS (
    SELECT i.client_id, i.uk, i.days_listed,
           CASE
             WHEN COALESCE(i.cond, fc.c, '') ~* '^\s*new' THEN 'N'
             WHEN NULLIF(btrim(COALESCE(i.cond, fc.c, '')), '') IS NOT NULL THEN 'U'
             WHEN i.url ~* '[/_-]new[/_-]' THEN 'N'
             ELSE 'U'
           END AS cond,
           COALESCE(ut.views, 0) AS views,
           COALESCE(ut.max_v, 0) AS max_v
    FROM inv i
    LEFT JOIN fin_condition fc ON fc.client_id = i.client_id AND fc.uk = i.uk
    LEFT JOIN unit_totals ut ON ut.client_id = i.client_id AND ut.uk = i.uk
  ),
  -- Each unit counts in its dealer's 'all' and condition buckets, and the same for the 'ALL' dealer total.
  bucketed AS (
    SELECT u.*, b.dealer_key, b.grp
    FROM units u
    CROSS JOIN LATERAL (VALUES (u.client_id, 'all'), (u.client_id, u.cond), ('ALL', 'all'), ('ALL', u.cond)) b(dealer_key, grp)
  ),
  ranked AS (
    SELECT b.*,
           row_number() OVER (PARTITION BY dealer_key, grp ORDER BY views) AS rn_asc,
           row_number() OVER (PARTITION BY dealer_key, grp ORDER BY views DESC) AS rn_desc,
           count(*) OVER (PARTITION BY dealer_key, grp) AS n
    FROM bucketed b
  ),
  stats AS (
    SELECT dealer_key, grp,
           count(*) AS count,
           SUM(r.days_listed::numeric / NULLIF(sd.days, 0)) AS in_stock,
           SUM(r.views) AS views,
           count(*) FILTER (WHERE r.views > 0) AS viewed,
           max(r.views) FILTER (WHERE r.rn_asc = floor(r.n / 2) + 1) AS median,
           count(*) FILTER (WHERE r.views >= 10 AND r.max_v / NULLIF(r.views, 0) >= 0.7) AS dependent,
           SUM(r.views) FILTER (WHERE r.rn_desc <= ceil(r.n * 0.2)) AS top_views
    FROM ranked r
    JOIN snap_days sd ON sd.client_id = r.client_id
    GROUP BY 1, 2
  ),
  channel_totals AS (
    SELECT b.dealer_key, b.grp, uc.channel, SUM(uc.v) AS v
    FROM bucketed b
    JOIN unit_channel uc ON uc.client_id = b.client_id AND uc.uk = b.uk
    GROUP BY 1, 2, 3
  ),
  top_channel AS (
    SELECT DISTINCT ON (dealer_key, grp) dealer_key, grp, channel, v
    FROM channel_totals
    ORDER BY dealer_key, grp, v DESC, channel
  ),
  names AS (
    SELECT DISTINCT ON (btrim(ga4_customer_id)) btrim(ga4_customer_id) AS client_id, customer_name
    FROM smart_hoot_config
    WHERE is_active AND NULLIF(btrim(ga4_customer_id), '') IS NOT NULL
    ORDER BY btrim(ga4_customer_id), customer_name
  ),
  stats_json AS (
    SELECT s.dealer_key,
           jsonb_object_agg(s.grp, jsonb_build_object(
             'count', s.count,
             'inStock', round(s.in_stock, 2),
             'views', s.views,
             'viewed', s.viewed,
             'zero', s.count - s.viewed,
             'median', COALESCE(s.median, 0),
             'dependent', s.dependent,
             'topShare', COALESCE(round(100 * s.top_views / NULLIF(s.views, 0), 2), 0),
             'topChannel', tc.channel,
             'topChannelShare', COALESCE(round(100 * tc.v / NULLIF(s.views, 0), 2), 0)
           )) AS stats
    FROM stats s
    LEFT JOIN top_channel tc ON tc.dealer_key = s.dealer_key AND tc.grp = s.grp
    GROUP BY s.dealer_key
  )
  SELECT jsonb_build_object(
    'dealers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'clientId', sj.dealer_key,
               'name', COALESCE(n.customer_name, sj.dealer_key),
               'stats', sj.stats
             ) ORDER BY COALESCE(n.customer_name, sj.dealer_key))
      FROM stats_json sj
      LEFT JOIN names n ON n.client_id = sj.dealer_key
      WHERE sj.dealer_key <> 'ALL'
    ), '[]'::jsonb),
    'total', (SELECT stats FROM stats_json WHERE dealer_key = 'ALL')
  );
$function$;

REVOKE ALL ON FUNCTION public.get_vdp_analysis_summary(date, date, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_vdp_analysis_summary(date, date, text[]) TO service_role;

-- All-dealer summaries take several seconds, so each range is cached until the daily tables change.
CREATE TABLE IF NOT EXISTS public.smart_vdp_summary_cache (
  from_date date NOT NULL,
  to_date date NOT NULL,
  payload jsonb NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (from_date, to_date)
);
ALTER TABLE public.smart_vdp_summary_cache ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.get_vdp_analysis_summary_cached(p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '30s'
AS $function$
DECLARE
  v_payload jsonb;
BEGIN
  SELECT payload INTO v_payload FROM smart_vdp_summary_cache WHERE from_date = p_from AND to_date = p_to;
  IF v_payload IS NULL THEN
    v_payload := public.get_vdp_analysis_summary(p_from, p_to, NULL);
    INSERT INTO smart_vdp_summary_cache (from_date, to_date, payload)
    VALUES (p_from, p_to, v_payload)
    ON CONFLICT (from_date, to_date) DO UPDATE SET payload = EXCLUDED.payload, computed_at = now();
  END IF;
  RETURN v_payload;
END;
$function$;

CREATE OR REPLACE FUNCTION public.vdp_summary_cache_clear()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM smart_vdp_summary_cache;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_vdp_summary_cache_inventory ON public.smart_vdp_inventory_daily;
CREATE TRIGGER trg_vdp_summary_cache_inventory
  AFTER INSERT OR UPDATE OR DELETE ON public.smart_vdp_inventory_daily
  FOR EACH STATEMENT EXECUTE FUNCTION public.vdp_summary_cache_clear();
DROP TRIGGER IF EXISTS trg_vdp_summary_cache_views ON public.smart_vdp_unit_views_daily;
CREATE TRIGGER trg_vdp_summary_cache_views
  AFTER INSERT OR UPDATE OR DELETE ON public.smart_vdp_unit_views_daily
  FOR EACH STATEMENT EXECUTE FUNCTION public.vdp_summary_cache_clear();

REVOKE ALL ON FUNCTION public.get_vdp_analysis_summary_cached(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_vdp_analysis_summary_cached(date, date) TO service_role;
REVOKE ALL ON FUNCTION public.vdp_summary_cache_clear() FROM PUBLIC, anon, authenticated;
