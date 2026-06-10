-- Top campaigns by views (all campaigns when p_limit IS NULL).
-- Same fast/slow path pattern as get_ga4_channel_breakdown.
-- Run in Supabase SQL editor.

DROP FUNCTION IF EXISTS public.get_top_campaigns(text, date, date, text, integer);
DROP FUNCTION IF EXISTS public.get_top_campaigns(text, date, date, text, integer, integer[]);
DROP FUNCTION IF EXISTS public.get_top_campaigns(
  text, date, date, text, integer, text[], text[], text[], text[], integer[], text
);

CREATE OR REPLACE FUNCTION public.get_top_campaigns(
  p_client_id text,
  p_from      date,
  p_to        date,
  p_page_type text   DEFAULT 'ALL',
  p_limit     integer DEFAULT NULL,
  p_types     text[] DEFAULT NULL,
  p_makes     text[] DEFAULT NULL,
  p_models    text[] DEFAULT NULL,
  p_locations text[] DEFAULT NULL,
  p_years     integer[] DEFAULT NULL,
  p_condition text   DEFAULT 'BOTH'
)
RETURNS TABLE (
  campaign    text,
  source      text,
  medium      text,
  channel     text,
  views       bigint,
  sessions    bigint,
  total_users bigint,
  new_users   bigint,
  pct         numeric,
  rank        integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_filter_active boolean;
  v_page_type     text := UPPER(COALESCE(p_page_type, 'ALL'));
  v_condition     text := UPPER(COALESCE(p_condition, 'BOTH'));
BEGIN
  v_filter_active :=
       COALESCE(array_length(p_types, 1), 0)     > 0
    OR COALESCE(array_length(p_makes, 1), 0)     > 0
    OR COALESCE(array_length(p_models, 1), 0)    > 0
    OR COALESCE(array_length(p_locations, 1), 0) > 0
    OR COALESCE(array_length(p_years, 1), 0)     > 0
    OR v_condition <> 'BOTH';

  RETURN QUERY
  WITH pages AS (
    SELECT
      p.session_campaign,
      p.source,
      p.medium,
      p.channel,
      p.views,
      p.sessions,
      p.total_users,
      p.new_users,
      p.client_id,
      p.report_date,
      p.page_path
    FROM smart_ga4_page_data p
    WHERE p.client_id = p_client_id
      AND p.report_date BETWEEN p_from AND p_to
      AND (
        v_page_type = 'ALL'
        OR (v_page_type = 'VDP'   AND p.ga4_page_type ILIKE 'VDP%')
        OR (v_page_type = 'SRP'   AND p.ga4_page_type = 'SRP')
        OR (v_page_type = 'HOME'  AND p.ga4_page_type ILIKE 'home%')
        OR (v_page_type = 'OTHER' AND p.ga4_page_type NOT ILIKE 'VDP%'
                                  AND p.ga4_page_type <> 'SRP'
                                  AND p.ga4_page_type NOT ILIKE 'home%')
      )
  ),
  filtered AS (
    SELECT
      COALESCE(NULLIF(TRIM(p.session_campaign), ''), '(not set)') AS campaign,
      COALESCE(NULLIF(TRIM(p.source), ''), '(direct)') AS source,
      COALESCE(NULLIF(TRIM(p.medium), ''), '(none)') AS medium,
      COALESCE(NULLIF(TRIM(p.channel), ''), '(other)') AS channel,
      p.views,
      p.sessions,
      p.total_users,
      p.new_users
    FROM pages p
    WHERE NOT v_filter_active

    UNION ALL

    SELECT
      COALESCE(NULLIF(TRIM(p.session_campaign), ''), '(not set)') AS campaign,
      COALESCE(NULLIF(TRIM(p.source), ''), '(direct)') AS source,
      COALESCE(NULLIF(TRIM(p.medium), ''), '(none)') AS medium,
      COALESCE(NULLIF(TRIM(p.channel), ''), '(other)') AS channel,
      p.views,
      p.sessions,
      p.total_users,
      p.new_users
    FROM pages p
    JOIN smart_final_data s
      ON s.client_id   = p.client_id
     AND s.report_date = p.report_date
     AND s.page_path   = p.page_path
    WHERE v_filter_active
      AND (p_types     IS NULL OR array_length(p_types, 1)     = 0 OR s.inv_type     = ANY(p_types))
      AND (p_makes     IS NULL OR array_length(p_makes, 1)     = 0 OR s.inv_make     = ANY(p_makes))
      AND (p_models    IS NULL OR array_length(p_models, 1)    = 0 OR s.inv_model    = ANY(p_models))
      AND (p_locations IS NULL OR array_length(p_locations, 1) = 0 OR s.inv_location = ANY(p_locations))
      AND (p_years     IS NULL OR array_length(p_years, 1)     = 0
           OR (s.inv_year ~ '^\d{4}$' AND s.inv_year::int = ANY(p_years)))
      AND (v_condition = 'BOTH' OR UPPER(s.inv_condition) = v_condition)
  ),
  agg AS (
    SELECT
      f.campaign,
      f.source,
      f.medium,
      f.channel,
      SUM(f.views)::bigint AS views,
      SUM(f.sessions)::bigint AS sessions,
      SUM(f.total_users)::bigint AS total_users,
      SUM(f.new_users)::bigint AS new_users
    FROM filtered f
    GROUP BY f.campaign, f.source, f.medium, f.channel
  ),
  ranked AS (
    SELECT
      a.*,
      ROW_NUMBER() OVER (ORDER BY a.views DESC, a.campaign, a.source, a.medium) AS rn
    FROM agg a
    WHERE a.views > 0
  ),
  top_n AS (
    SELECT * FROM ranked r
    WHERE p_limit IS NULL OR r.rn <= p_limit
  ),
  grand AS (
    SELECT NULLIF(SUM(r.views), 0)::numeric AS total FROM ranked r
  )
  SELECT
    t.campaign,
    t.source,
    t.medium,
    t.channel,
    t.views,
    t.sessions,
    t.total_users,
    t.new_users,
    ROUND(100.0 * t.views / g.total, 2) AS pct,
    t.rn::integer AS rank
  FROM top_n t
  CROSS JOIN grand g
  ORDER BY t.rn;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_top_campaigns(
  text, date, date, text, integer, text[], text[], text[], text[], integer[], text
) TO authenticated, service_role;
