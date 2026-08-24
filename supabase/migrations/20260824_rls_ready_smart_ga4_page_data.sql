-- RLS readiness for smart_ga4_page_data.
-- Run this in Supabase SQL Editor BEFORE enabling RLS on smart_ga4_page_data.
-- Does NOT enable RLS — only hardens RPCs used by the Next.js dashboard + pipeline.
-- Note: smart_ga4_data is optional; get_ga4_user_totals returns empty if that table is missing.

-- ── 1. Overview RPC (reads smart_ga4_page_data) ─────────────────────────────

CREATE OR REPLACE FUNCTION public.get_ga4_overview(
  p_client_id text,
  p_from date,
  p_to date
)
RETURNS TABLE(
  report_date date,
  ga4_page_type text,
  views bigint,
  unique_pages bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    report_date,
    ga4_page_type,
    SUM(views)::bigint                AS views,
    COUNT(DISTINCT page_path)::bigint AS unique_pages
  FROM smart_ga4_page_data
  WHERE client_id = p_client_id
    AND report_date BETWEEN p_from AND p_to
  GROUP BY report_date, ga4_page_type
  ORDER BY report_date, ga4_page_type;
$$;

CREATE OR REPLACE FUNCTION public.get_ga4_user_totals(
  p_client_id text,
  p_from date,
  p_to date
)
RETURNS TABLE(
  report_date date,
  total_users bigint,
  new_users bigint,
  sessions bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'smart_ga4_data'
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    d.report_date,
    SUM(d.total_users)::bigint AS total_users,
    SUM(d.new_users)::bigint   AS new_users,
    SUM(d.sessions)::bigint    AS sessions
  FROM smart_ga4_data d
  WHERE d.client_id = p_client_id
    AND d.report_date BETWEEN p_from AND p_to
  GROUP BY d.report_date
  ORDER BY d.report_date;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_ga4_overview(text, date, date)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_ga4_user_totals(text, date, date)
  TO anon, authenticated, service_role;

-- ── 2. Pipeline Step 2 — UPDATE smart_ga4_page_data (service_role only) ─────

CREATE OR REPLACE FUNCTION public.apply_vdp_filtration(
  p_client_id text DEFAULT NULL,
  p_days_back integer DEFAULT NULL
)
RETURNS TABLE(out_account_name text, out_cms text, out_updated_rows bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE smart_ga4_page_data g
  SET cms = h.website_platform
  FROM smart_hoot_config h
  WHERE g.report_date >= (CURRENT_DATE - p_days_back)
    AND (g.cms IS NULL OR g.cms = '')
    AND g.client_id = h.ga4_customer_id::text
    AND (p_client_id IS NULL OR g.client_id = p_client_id);

  RETURN QUERY
  WITH updated_data AS (
    UPDATE smart_ga4_page_data g
    SET
      vdp_conditions = public.page_path_matches_vdp_logic(g.page_path, sl.vdp_logic),
      ga4_page_type = CASE
        WHEN public.page_path_matches_vdp_logic(g.page_path, sl.vdp_logic) THEN 'VDP'
        WHEN sl.home_page_logic IS NOT NULL AND sl.home_page_logic <> ''
             AND LOWER(sl.home_page_logic) NOT IN ('true','false')
             AND g.page_path ~* sl.home_page_logic THEN 'Home page'
        WHEN sl.srp_logic IS NOT NULL AND sl.srp_logic <> ''
             AND LOWER(sl.srp_logic) NOT IN ('true','false')
             AND g.page_path ~* sl.srp_logic THEN 'SRP'
        ELSE 'Other Page'
      END,
      vdp_vehicle_condition = CASE
        WHEN public.page_path_matches_vdp_logic(g.page_path, sl.vdp_logic) THEN
          CASE
            WHEN g.page_path ILIKE '%new%'  THEN 'New'
            WHEN g.page_path ILIKE '%used%' THEN 'Used'
            ELSE NULL
          END
        ELSE NULL
      END,
      year = CASE
        WHEN public.page_path_matches_vdp_logic(g.page_path, sl.vdp_logic)
             AND g.page_path ~* '\d{4}'
        THEN SUBSTRING(g.page_path FROM '(\d{4})')::INTEGER
        ELSE NULL
      END
    FROM smart_vdp_logic sl
    WHERE g.report_date >= (CURRENT_DATE - p_days_back)
      AND g.client_id = sl.dealer_id
      AND sl.vdp_logic IS NOT NULL
      AND sl.vdp_logic <> ''
      AND EXISTS (
        SELECT 1
        FROM unnest(regexp_split_to_array(sl.vdp_logic, E'\\s+OR\\s+', 'i')) AS pat
        WHERE btrim(pat) <> ''
          AND lower(btrim(pat)) NOT IN ('true', 'false')
          AND length(btrim(pat)) >= 5
      )
      AND (p_client_id IS NULL OR g.client_id = p_client_id)
    RETURNING g.account_name, g.cms
  )
  SELECT updated_data.account_name, updated_data.cms, COUNT(*)::bigint
  FROM updated_data
  GROUP BY updated_data.account_name, updated_data.cms;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_vdp_filtration_range(
  p_client_id text DEFAULT NULL,
  p_from      date  DEFAULT NULL,
  p_to        date  DEFAULT NULL
)
RETURNS TABLE(out_account_name text, out_cms text, out_updated_rows bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_from IS NULL OR p_to IS NULL THEN
    RAISE EXCEPTION 'p_from and p_to are required';
  END IF;

  UPDATE smart_ga4_page_data g
  SET cms = h.website_platform
  FROM smart_hoot_config h
  WHERE g.report_date BETWEEN p_from AND p_to
    AND (g.cms IS NULL OR g.cms = '')
    AND g.client_id = h.ga4_customer_id::text
    AND (p_client_id IS NULL OR g.client_id = p_client_id);

  RETURN QUERY
  WITH updated_data AS (
    UPDATE smart_ga4_page_data g
    SET
      vdp_conditions = public.page_path_matches_vdp_logic(g.page_path, sl.vdp_logic),
      ga4_page_type = CASE
        WHEN public.page_path_matches_vdp_logic(g.page_path, sl.vdp_logic) THEN 'VDP'
        WHEN sl.home_page_logic IS NOT NULL AND sl.home_page_logic <> ''
             AND LOWER(sl.home_page_logic) NOT IN ('true','false')
             AND g.page_path ~* sl.home_page_logic THEN 'Home page'
        WHEN sl.srp_logic IS NOT NULL AND sl.srp_logic <> ''
             AND LOWER(sl.srp_logic) NOT IN ('true','false')
             AND g.page_path ~* sl.srp_logic THEN 'SRP'
        ELSE 'Other Page'
      END,
      vdp_vehicle_condition = CASE
        WHEN public.page_path_matches_vdp_logic(g.page_path, sl.vdp_logic) THEN
          CASE
            WHEN g.page_path ILIKE '%new%'  THEN 'New'
            WHEN g.page_path ILIKE '%used%' THEN 'Used'
            ELSE NULL
          END
        ELSE NULL
      END,
      year = CASE
        WHEN public.page_path_matches_vdp_logic(g.page_path, sl.vdp_logic)
             AND g.page_path ~* '\d{4}'
        THEN SUBSTRING(g.page_path FROM '(\d{4})')::INTEGER
        ELSE NULL
      END
    FROM smart_vdp_logic sl
    WHERE g.report_date BETWEEN p_from AND p_to
      AND g.client_id = sl.dealer_id
      AND sl.vdp_logic IS NOT NULL
      AND sl.vdp_logic <> ''
      AND EXISTS (
        SELECT 1
        FROM unnest(regexp_split_to_array(sl.vdp_logic, E'\\s+OR\\s+', 'i')) AS pat
        WHERE btrim(pat) <> ''
          AND lower(btrim(pat)) NOT IN ('true', 'false')
          AND length(btrim(pat)) >= 5
      )
      AND (p_client_id IS NULL OR g.client_id = p_client_id)
    RETURNING g.account_name, g.cms
  )
  SELECT updated_data.account_name, updated_data.cms, COUNT(*)::bigint
  FROM updated_data
  GROUP BY updated_data.account_name, updated_data.cms;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_vdp_filtration(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_vdp_filtration_range(text, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_vdp_filtration(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_vdp_filtration_range(text, date, date) TO service_role;
