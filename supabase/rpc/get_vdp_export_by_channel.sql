-- VDP export: date-wise rows per inv_url + channel (XLSX "By Channel" sheet).
-- URL from smart_final_data.inv_url (not hoot_url feed). Deploy in Supabase SQL editor.

DROP FUNCTION IF EXISTS public.get_vdp_export_by_channel(
  text, date, date, text[], text[], text[], text[], integer[], text
);

CREATE OR REPLACE FUNCTION public.get_vdp_export_by_channel(
  p_client_id text,
  p_from date,
  p_to date,
  p_types text[] DEFAULT NULL,
  p_makes text[] DEFAULT NULL,
  p_models text[] DEFAULT NULL,
  p_locations text[] DEFAULT NULL,
  p_years integer[] DEFAULT NULL,
  p_condition text DEFAULT 'BOTH'
)
RETURNS TABLE (
  report_date date,
  url text,
  views bigint,
  channel text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH final_rows AS (
    SELECT
      s.report_date,
      s.page_path,
      s.client_id,
      CASE
        WHEN NULLIF(TRIM(s.inv_url), '') ~* '^https?://' THEN TRIM(s.inv_url)
        WHEN NULLIF(TRIM(s.page_location), '') ~* '^https?://'
             AND TRIM(s.page_location) !~* 'hootinteractive\.net' THEN TRIM(s.page_location)
        ELSE NULL
      END AS url,
      s.inv_type,
      s.inv_make,
      s.inv_model,
      s.inv_location,
      s.inv_year,
      s.inv_condition
    FROM smart_final_data s
    WHERE s.client_id::text = trim(p_client_id)
      AND s.report_date BETWEEN p_from AND p_to
      AND (s.ga4_page_type ILIKE 'VDP%' OR s.vdp_conditions IS TRUE)
      AND (COALESCE(array_length(p_types, 1), 0) = 0 OR s.inv_type = ANY(p_types))
      AND (COALESCE(array_length(p_makes, 1), 0) = 0 OR s.inv_make = ANY(p_makes))
      AND (COALESCE(array_length(p_models, 1), 0) = 0 OR s.inv_model = ANY(p_models))
      AND (COALESCE(array_length(p_locations, 1), 0) = 0 OR s.inv_location = ANY(p_locations))
      AND (
        COALESCE(array_length(p_years, 1), 0) = 0
        OR (s.inv_year ~ '^\d{4}$' AND s.inv_year::int = ANY(p_years))
      )
      AND (
        UPPER(COALESCE(p_condition, 'BOTH')) = 'BOTH'
        OR UPPER(s.inv_condition) = UPPER(p_condition)
      )
  ),
  combined AS (
    SELECT
      f.report_date,
      f.url,
      p.channel,
      COALESCE(p.views, 0)::bigint AS views
    FROM final_rows f
    JOIN smart_ga4_page_data p
      ON p.client_id = f.client_id
     AND p.report_date = f.report_date
     AND p.page_path = f.page_path
     AND p.ga4_page_type ILIKE 'VDP%'
    WHERE f.url IS NOT NULL AND f.url <> ''
  ),
  normalized AS (
    SELECT
      c.report_date,
      c.url,
      CASE lower(trim(COALESCE(c.channel, '')))
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
        ELSE initcap(replace(replace(lower(trim(c.channel)), '_', ' '), '-', ' '))
      END AS channel,
      c.views
    FROM combined c
  ),
  agg AS (
    SELECT n.report_date, n.url, n.channel, SUM(n.views)::bigint AS views
    FROM normalized n
    GROUP BY n.report_date, n.url, n.channel
  )
  SELECT a.report_date, a.url, a.views, a.channel
  FROM agg a
  WHERE a.views > 0
  ORDER BY a.report_date DESC, a.views DESC, a.url, a.channel;
$$;

GRANT EXECUTE ON FUNCTION public.get_vdp_export_by_channel(
  text, date, date, text[], text[], text[], text[], integer[], text
) TO anon, authenticated, service_role;
