-- All tab export: all smart_ga4_page_data columns except id, client_id, ga4_property_id.
-- Deploy in Supabase SQL editor.

DROP FUNCTION IF EXISTS public.get_all_tab_export(text, date, date);

CREATE OR REPLACE FUNCTION public.get_all_tab_export(
  p_client_id text,
  p_from date,
  p_to date
)
RETURNS TABLE (
  account_name text,
  report_date date,
  page_location text,
  page_path text,
  page_title text,
  session_campaign text,
  channel text,
  source text,
  medium text,
  source_medium text,
  views bigint,
  total_users bigint,
  sessions bigint,
  new_users bigint,
  created_at timestamptz,
  vdp_conditions boolean,
  vdp_vehicle_condition text,
  year integer,
  ga4_page_type text,
  cms text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.account_name,
    p.report_date,
    COALESCE(NULLIF(TRIM(p.page_location), ''), NULLIF(TRIM(p.page_path), '')) AS page_location,
    p.page_path,
    p.page_title,
    COALESCE(NULLIF(TRIM(p.session_campaign), ''), '(not set)') AS session_campaign,
    p.channel,
    p.source,
    p.medium,
    p.source_medium,
    COALESCE(p.views, 0)::bigint AS views,
    COALESCE(p.total_users, 0)::bigint AS total_users,
    COALESCE(p.sessions, 0)::bigint AS sessions,
    COALESCE(p.new_users, 0)::bigint AS new_users,
    p.created_at,
    COALESCE(p.vdp_conditions, false) AS vdp_conditions,
    p.vdp_vehicle_condition,
    p.year,
    p.ga4_page_type,
    p.cms
  FROM smart_ga4_page_data p
  WHERE p.client_id::text = trim(p_client_id)
    AND p.report_date BETWEEN p_from AND p_to
  ORDER BY p.report_date DESC, p.views DESC, p.page_location, p.id;
$$;

GRANT EXECUTE ON FUNCTION public.get_all_tab_export(text, date, date)
  TO anon, authenticated, service_role;
