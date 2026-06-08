-- Top campaigns by views (all campaigns when p_limit IS NULL).
-- Run in Supabase SQL editor.

DROP FUNCTION IF EXISTS public.get_top_campaigns(text, date, date, text, integer);
DROP FUNCTION IF EXISTS public.get_top_campaigns(text, date, date, text, integer, integer[]);

CREATE OR REPLACE FUNCTION public.get_top_campaigns(
  p_client_id text,
  p_from      date,
  p_to        date,
  p_page_type text DEFAULT 'ALL',
  p_limit     integer DEFAULT NULL,
  p_types     text[] DEFAULT NULL,
  p_makes     text[] DEFAULT NULL,
  p_models    text[] DEFAULT NULL,
  p_locations text[] DEFAULT NULL,
  p_years     integer[] DEFAULT NULL,
  p_condition text DEFAULT 'BOTH'
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
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH inv_filter_active AS (
    SELECT (
      COALESCE(array_length(p_types, 1), 0)     > 0 OR
      COALESCE(array_length(p_makes, 1), 0)     > 0 OR
      COALESCE(array_length(p_models, 1), 0)    > 0 OR
      COALESCE(array_length(p_locations, 1), 0) > 0 OR
      COALESCE(array_length(p_years, 1), 0)     > 0 OR
      UPPER(COALESCE(p_condition, 'BOTH')) <> 'BOTH'
    ) AS active
  ),
  page_base AS (
    SELECT *
    FROM smart_ga4_page_data
    WHERE client_id = p_client_id
      AND report_date BETWEEN p_from AND p_to
      AND (
        (UPPER(p_page_type) = 'ALL')
        OR (UPPER(p_page_type) = 'VDP'   AND UPPER(COALESCE(ga4_page_type, '')) LIKE 'VDP%')
        OR (UPPER(p_page_type) = 'SRP'   AND UPPER(COALESCE(ga4_page_type, '')) = 'SRP')
        OR (UPPER(p_page_type) = 'HOME'  AND LOWER(COALESCE(ga4_page_type, '')) = 'home page')
        OR (UPPER(p_page_type) = 'OTHER' AND UPPER(COALESCE(ga4_page_type, '')) NOT LIKE 'VDP%'
                                       AND UPPER(COALESCE(ga4_page_type, '')) <> 'SRP'
                                       AND LOWER(COALESCE(ga4_page_type, '')) <> 'home page')
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
    FROM page_base p
    CROSS JOIN inv_filter_active a
    WHERE NOT a.active
       OR EXISTS (
         SELECT 1
         FROM smart_final_data s
         WHERE s.client_id = p.client_id
           AND s.report_date = p.report_date
           AND s.page_path = p.page_path
           AND (COALESCE(array_length(p_types, 1), 0) = 0     OR s.inv_type     = ANY(p_types))
           AND (COALESCE(array_length(p_makes, 1), 0) = 0     OR s.inv_make     = ANY(p_makes))
           AND (COALESCE(array_length(p_models, 1), 0) = 0    OR s.inv_model    = ANY(p_models))
           AND (COALESCE(array_length(p_locations, 1), 0) = 0 OR s.inv_location = ANY(p_locations))
           AND (COALESCE(array_length(p_years, 1), 0) = 0     OR (s.inv_year ~ '^\d{4}$' AND s.inv_year::int = ANY(p_years)))
           AND (UPPER(COALESCE(p_condition, 'BOTH')) = 'BOTH' OR UPPER(s.inv_condition) = UPPER(p_condition))
       )
  ),
  agg AS (
    SELECT
      campaign,
      source,
      medium,
      channel,
      SUM(views)::bigint AS views,
      SUM(sessions)::bigint AS sessions,
      SUM(total_users)::bigint AS total_users,
      SUM(new_users)::bigint AS new_users
    FROM filtered
    GROUP BY campaign, source, medium, channel
  ),
  ranked AS (
    SELECT
      *,
      ROW_NUMBER() OVER (ORDER BY views DESC, campaign, source, medium) AS rn
    FROM agg
    WHERE views > 0
  ),
  top_n AS (
    SELECT * FROM ranked
    WHERE p_limit IS NULL OR rn <= p_limit
  ),
  grand AS (
    SELECT NULLIF(SUM(views), 0)::numeric AS total FROM ranked
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
$$;

GRANT EXECUTE ON FUNCTION public.get_top_campaigns(
  text, date, date, text, integer, text[], text[], text[], text[], integer[], text
) TO authenticated, service_role;
