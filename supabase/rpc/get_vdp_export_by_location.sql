-- VDP export: date-wise rows per inv_url + location (XLSX "By Location" sheet).
-- URL from smart_final_data.inv_url. Deploy in Supabase SQL editor.

DROP FUNCTION IF EXISTS public.get_vdp_export_by_location(
  text, date, date, text[], text[], text[], text[], integer[], text
);

CREATE OR REPLACE FUNCTION public.get_vdp_export_by_location(
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
  location text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH filtered AS (
    SELECT
      report_date,
      CASE
        WHEN NULLIF(TRIM(inv_url), '') ~* '^https?://' THEN TRIM(inv_url)
        WHEN NULLIF(TRIM(page_location), '') ~* '^https?://'
             AND TRIM(page_location) !~* 'hootinteractive\.net' THEN TRIM(page_location)
        ELSE NULL
      END AS url,
      COALESCE(NULLIF(TRIM(inv_location), ''), 'Unknown') AS location,
      COALESCE(views, 0)::bigint AS v
    FROM smart_final_data
    WHERE client_id::text = trim(p_client_id)
      AND report_date BETWEEN p_from AND p_to
      AND (ga4_page_type ILIKE 'VDP%' OR vdp_conditions IS TRUE)
      AND (COALESCE(array_length(p_types, 1), 0) = 0 OR inv_type = ANY(p_types))
      AND (COALESCE(array_length(p_makes, 1), 0) = 0 OR inv_make = ANY(p_makes))
      AND (COALESCE(array_length(p_models, 1), 0) = 0 OR inv_model = ANY(p_models))
      AND (COALESCE(array_length(p_locations, 1), 0) = 0 OR inv_location = ANY(p_locations))
      AND (
        COALESCE(array_length(p_years, 1), 0) = 0
        OR (inv_year ~ '^\d{4}$' AND inv_year::int = ANY(p_years))
      )
      AND (
        UPPER(COALESCE(p_condition, 'BOTH')) = 'BOTH'
        OR UPPER(inv_condition) = UPPER(p_condition)
      )
  ),
  agg AS (
    SELECT report_date, url, location, SUM(v)::bigint AS views
    FROM filtered
    WHERE url IS NOT NULL AND url <> '' AND v > 0
    GROUP BY report_date, url, location
  )
  SELECT a.report_date, a.url, a.views, a.location
  FROM agg a
  WHERE a.views > 0
  ORDER BY a.report_date DESC, a.views DESC, a.url, a.location;
$$;

GRANT EXECUTE ON FUNCTION public.get_vdp_export_by_location(
  text, date, date, text[], text[], text[], text[], integer[], text
) TO anon, authenticated, service_role;
