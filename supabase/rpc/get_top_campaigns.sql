-- Top campaigns by views (all campaigns when p_limit IS NULL).
-- Run in Supabase SQL editor.

DROP FUNCTION IF EXISTS public.get_top_campaigns(text, date, date, text, integer);

CREATE OR REPLACE FUNCTION public.get_top_campaigns(
  p_client_id text,
  p_from      date,
  p_to        date,
  p_page_type text DEFAULT 'ALL',
  p_limit     integer DEFAULT NULL
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
  WITH filtered AS (
    SELECT
      COALESCE(NULLIF(TRIM(session_campaign), ''), '(not set)') AS campaign,
      COALESCE(NULLIF(TRIM(source), ''), '(direct)') AS source,
      COALESCE(NULLIF(TRIM(medium), ''), '(none)') AS medium,
      COALESCE(NULLIF(TRIM(channel), ''), '(other)') AS channel,
      views,
      sessions,
      total_users,
      new_users
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

GRANT EXECUTE ON FUNCTION public.get_top_campaigns(text, date, date, text, integer)
  TO authenticated, service_role;
