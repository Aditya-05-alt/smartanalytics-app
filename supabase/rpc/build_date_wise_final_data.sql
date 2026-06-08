-- Admin pipeline Table 3 — daily SUM(views) from smart_final_data.
-- Run in Supabase SQL editor (same client_id / date filters as build_date_wise_ga4_data).

DROP FUNCTION IF EXISTS public.build_date_wise_final_data(date, date, text);
DROP FUNCTION IF EXISTS public.build_date_wise_final_data(date, date, text, integer[]);

CREATE OR REPLACE FUNCTION public.build_date_wise_final_data(
  p_date_from   date DEFAULT NULL,
  p_date_to     date DEFAULT NULL,
  p_client_id   text DEFAULT NULL,
  p_types       text[] DEFAULT NULL,
  p_makes       text[] DEFAULT NULL,
  p_models      text[] DEFAULT NULL,
  p_locations   text[] DEFAULT NULL,
  p_years       integer[] DEFAULT NULL,
  p_condition   text DEFAULT 'BOTH'
)
RETURNS TABLE (
  report_date date,
  client_id   text,
  views       bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    f.report_date,
    f.client_id::text AS client_id,
    COALESCE(SUM(f.views), 0)::bigint AS views
  FROM public.smart_final_data f
  WHERE f.report_date >= COALESCE(p_date_from, f.report_date)
    AND f.report_date <= COALESCE(p_date_to, f.report_date)
    AND (
      p_client_id IS NULL
      OR f.client_id::text = trim(p_client_id)
    )
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
  GROUP BY f.report_date, f.client_id
  ORDER BY f.report_date;
$$;

GRANT EXECUTE ON FUNCTION public.build_date_wise_final_data(
  date, date, text, text[], text[], text[], text[], integer[], text
) TO anon, authenticated, service_role;
