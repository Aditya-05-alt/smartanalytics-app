-- All-dealer portfolio channel matrix (VDP / All tabs + date range).
-- Optional p_client_ids for chunked fetches (faster, avoids gateway timeouts).
-- Deploy in Supabase SQL editor.

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
BEGIN
  RETURN QUERY
  WITH dealers AS (
    SELECT DISTINCT ON (h.ga4_customer_id)
      trim(h.ga4_customer_id::text) AS dealer_client_id,
      h.customer_name              AS dealer_label
    FROM public.smart_hoot_config h
    WHERE h.is_active IS TRUE
      AND h.ga4_customer_id IS NOT NULL
      AND trim(h.ga4_customer_id::text) <> ''
      AND (
        NOT v_chunked
        OR trim(h.ga4_customer_id::text) = ANY(p_client_ids)
      )
    ORDER BY h.ga4_customer_id, h.id DESC
  ),
  pages AS (
    SELECT
      p.client_id::text AS dealer_client_id,
      p.channel         AS raw_channel,
      SUM(COALESCE(p.views, 0))::bigint AS page_views
    FROM public.smart_ga4_page_data p
    INNER JOIN dealers d ON d.dealer_client_id = p.client_id::text
    WHERE p.report_date BETWEEN p_from AND p_to
      AND (
        v_page_type = 'ALL'
        OR (v_page_type = 'VDP' AND p.ga4_page_type ILIKE 'VDP%')
        OR (v_page_type = 'SRP' AND p.ga4_page_type = 'SRP')
        OR (v_page_type IN ('HOME', 'HOMEPAGE') AND p.ga4_page_type ILIKE 'home%')
        OR (
          v_page_type = 'OTHER'
          AND p.ga4_page_type NOT ILIKE 'VDP%'
          AND p.ga4_page_type <> 'SRP'
          AND p.ga4_page_type NOT ILIKE 'home%'
        )
      )
    GROUP BY p.client_id::text, p.channel
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

-- Speed up chunked date-range scans (run once in SQL editor):
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_smart_ga4_page_data_date_client
--   ON public.smart_ga4_page_data (report_date, client_id);
