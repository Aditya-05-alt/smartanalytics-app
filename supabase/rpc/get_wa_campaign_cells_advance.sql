-- Date × session_campaign views for WA| / WA | campaigns (one dealer).
-- Deploy in Supabase SQL editor (used by /api/dashboard/campaign-views_advance).

DROP FUNCTION IF EXISTS public.get_wa_campaign_cells_advance(text, date, date, text);

CREATE OR REPLACE FUNCTION public.get_wa_campaign_cells_advance(
  p_client_id text,
  p_from      date,
  p_to        date,
  p_page_type text DEFAULT 'ALL'
)
RETURNS TABLE (
  report_date date,
  campaign    text,
  views       bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '30s'
AS $$
  WITH params AS (
    SELECT
      trim(COALESCE(p_client_id, '')) AS client_id,
      UPPER(COALESCE(NULLIF(trim(p_page_type), ''), 'ALL')) AS page_type
  )
  SELECT
    p.report_date,
    TRIM(p.session_campaign) AS campaign,
    SUM(COALESCE(p.views, 0))::bigint AS views
  FROM public.smart_ga4_page_data p
  CROSS JOIN params x
  WHERE p.client_id = x.client_id
    AND p.report_date BETWEEN p_from AND p_to
    AND p.session_campaign IS NOT NULL
    AND TRIM(p.session_campaign) <> ''
    AND (
      TRIM(p.session_campaign) LIKE 'WA|%'
      OR TRIM(p.session_campaign) LIKE 'WA |%'
    )
    AND (
      x.page_type = 'ALL'
      OR (x.page_type = 'VDP' AND p.ga4_page_type ILIKE 'VDP%')
    )
  GROUP BY p.report_date, TRIM(p.session_campaign)
  HAVING SUM(COALESCE(p.views, 0)) > 0
  ORDER BY p.report_date, views DESC, campaign;
$$;

GRANT EXECUTE ON FUNCTION public.get_wa_campaign_cells_advance(text, date, date, text)
  TO anon, authenticated, service_role;
