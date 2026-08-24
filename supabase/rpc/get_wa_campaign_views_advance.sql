-- Fast dealer-scoped WA campaign views for Campaign Views tab (advance).
-- Only session_campaign values that start with "WA|" or "WA |" (optional space).
-- Returns structured JSON: { campaigns, daily, cells, meta } in one round-trip.
--
-- Deploy in Supabase SQL editor, then create the supporting index (run separately
-- if the table is large — CONCURRENTLY cannot run inside a transaction):
--
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ga4_wa_campaign_client_date
--   ON public.smart_ga4_page_data (client_id, report_date)
--   WHERE session_campaign ~ '^[[:space:]]*WA ?\|';

DROP FUNCTION IF EXISTS public.get_wa_campaign_views(text, date, date, text);
DROP FUNCTION IF EXISTS public.get_wa_campaign_views_advance(text, date, date, text);

CREATE OR REPLACE FUNCTION public.get_wa_campaign_views_advance(
  p_client_id text,
  p_from      date,
  p_to        date,
  p_page_type text DEFAULT 'ALL'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '30s'
AS $$
DECLARE
  v_client_id text := trim(COALESCE(p_client_id, ''));
  v_page_type text := UPPER(COALESCE(NULLIF(trim(p_page_type), ''), 'ALL'));
  v_result    jsonb;
BEGIN
  IF v_client_id = '' OR p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RAISE EXCEPTION 'Invalid args: client_id=%, from=%, to=%', p_client_id, p_from, p_to;
  END IF;

  IF v_client_id = '__all_dealer__' OR lower(v_client_id) = 'all' THEN
    RAISE EXCEPTION 'get_wa_campaign_views_advance requires a single dealer client_id';
  END IF;

  WITH base AS (
    SELECT
      TRIM(p.session_campaign) AS campaign,
      p.report_date,
      COALESCE(p.views, 0)::bigint AS views,
      COALESCE(p.sessions, 0)::bigint AS sessions,
      COALESCE(p.total_users, 0)::bigint AS total_users,
      COALESCE(p.new_users, 0)::bigint AS new_users
    FROM public.smart_ga4_page_data p
    WHERE p.client_id = v_client_id
      AND p.report_date BETWEEN p_from AND p_to
      AND p.session_campaign IS NOT NULL
      AND TRIM(p.session_campaign) <> ''
      -- WA|… or WA |… only
      AND (
        TRIM(p.session_campaign) LIKE 'WA|%'
        OR TRIM(p.session_campaign) LIKE 'WA |%'
      )
      AND (
        v_page_type = 'ALL'
        OR (v_page_type = 'VDP' AND p.ga4_page_type ILIKE 'VDP%')
      )
  ),
  by_campaign AS (
    SELECT
      b.campaign,
      SUM(b.views)::bigint AS views,
      SUM(b.sessions)::bigint AS sessions,
      SUM(b.total_users)::bigint AS total_users,
      SUM(b.new_users)::bigint AS new_users
    FROM base b
    GROUP BY b.campaign
    HAVING SUM(b.views) > 0
  ),
  campaign_ranked AS (
    SELECT
      c.*,
      SUM(c.views) OVER () AS grand_total,
      ROW_NUMBER() OVER (ORDER BY c.views DESC, c.campaign) AS rank
    FROM by_campaign c
  ),
  by_date AS (
    SELECT
      b.report_date,
      SUM(b.views)::bigint AS views
    FROM base b
    GROUP BY b.report_date
  ),
  by_date_campaign AS (
    SELECT
      b.report_date,
      b.campaign,
      SUM(b.views)::bigint AS views
    FROM base b
    GROUP BY b.report_date, b.campaign
    HAVING SUM(b.views) > 0
  ),
  campaigns_json AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'campaign', r.campaign,
          'views', r.views,
          'sessions', r.sessions,
          'total_users', r.total_users,
          'new_users', r.new_users,
          'pct', CASE
            WHEN r.grand_total > 0
              THEN ROUND((100.0 * r.views / r.grand_total)::numeric, 2)
            ELSE 0
          END,
          'rank', r.rank::integer
        )
        ORDER BY r.rank
      ),
      '[]'::jsonb
    ) AS arr
    FROM campaign_ranked r
  ),
  daily_json AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'report_date', d.report_date,
          'views', d.views
        )
        ORDER BY d.report_date
      ),
      '[]'::jsonb
    ) AS arr
    FROM by_date d
  ),
  cells_json AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'report_date', c.report_date,
          'campaign', c.campaign,
          'views', c.views
        )
        ORDER BY c.report_date, c.campaign
      ),
      '[]'::jsonb
    ) AS arr
    FROM by_date_campaign c
  )
  SELECT jsonb_build_object(
    'campaigns', c.arr,
    'daily', d.arr,
    'cells', x.arr,
    'meta', jsonb_build_object(
      'client_id', v_client_id,
      'from', p_from,
      'to', p_to,
      'page_type', v_page_type,
      'prefix', 'WA| / WA |',
      'total_views', COALESCE(
        (SELECT SUM(views)::bigint FROM by_campaign),
        0
      ),
      'campaign_count', COALESCE((SELECT COUNT(*)::integer FROM by_campaign), 0),
      'day_count', COALESCE((SELECT COUNT(*)::integer FROM by_date), 0)
    )
  )
  INTO v_result
  FROM campaigns_json c
  CROSS JOIN daily_json d
  CROSS JOIN cells_json x;

  RETURN COALESCE(v_result, jsonb_build_object(
    'campaigns', '[]'::jsonb,
    'daily', '[]'::jsonb,
    'cells', '[]'::jsonb,
    'meta', jsonb_build_object(
      'client_id', v_client_id,
      'from', p_from,
      'to', p_to,
      'page_type', v_page_type,
      'prefix', 'WA| / WA |',
      'total_views', 0,
      'campaign_count', 0,
      'day_count', 0
    )
  ));
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_wa_campaign_views_advance(text, date, date, text)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_wa_campaign_views_advance(text, date, date, text) IS
  'Advance: dealer-scoped WA| / WA | session_campaign views, date totals, and date×campaign cells as jsonb.';
