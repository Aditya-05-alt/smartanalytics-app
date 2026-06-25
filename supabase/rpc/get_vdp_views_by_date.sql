-- VDP tab daily chart series from smart_final_data (same filters as get_make_breakdown).
-- Deploy in Supabase SQL editor.

DROP FUNCTION IF EXISTS public.get_vdp_views_by_date(text, date, date);
DROP FUNCTION IF EXISTS public.get_vdp_views_by_date(text, date, date, text[], text[], text[], text[], integer[], text);

CREATE OR REPLACE FUNCTION public.get_vdp_views_by_date(
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
  views bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    f.report_date,
    COALESCE(SUM(COALESCE(f.views, 0)), 0)::bigint AS views
  FROM public.smart_final_data f
  WHERE f.client_id::text = trim(p_client_id)
    AND f.report_date BETWEEN p_from AND p_to
    AND (COALESCE(array_length(p_types, 1), 0) = 0 OR f.inv_type = ANY(p_types))
    AND (COALESCE(array_length(p_makes, 1), 0) = 0 OR f.inv_make = ANY(p_makes))
    AND (COALESCE(array_length(p_models, 1), 0) = 0 OR f.inv_model = ANY(p_models))
    AND (COALESCE(array_length(p_locations, 1), 0) = 0 OR f.inv_location = ANY(p_locations))
    AND (
      COALESCE(array_length(p_years, 1), 0) = 0
      OR (f.inv_year ~ '^\d{4}$' AND f.inv_year::int = ANY(p_years))
    )
    AND (
      UPPER(COALESCE(p_condition, 'BOTH')) = 'BOTH'
      OR UPPER(f.inv_condition) = UPPER(p_condition)
    )
  GROUP BY f.report_date
  ORDER BY f.report_date;
$$;

REVOKE ALL ON FUNCTION public.get_vdp_views_by_date(
  text, date, date, text[], text[], text[], text[], integer[], text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_vdp_views_by_date(
  text, date, date, text[], text[], text[], text[], integer[], text
) TO anon, authenticated, service_role;
