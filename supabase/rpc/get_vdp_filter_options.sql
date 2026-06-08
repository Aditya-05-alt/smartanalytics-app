-- Distinct VDP filter dropdown values for a dealer + date range.
-- Deploy in Supabase SQL editor.

DROP FUNCTION IF EXISTS public.get_vdp_filter_options(text, date, date);

CREATE OR REPLACE FUNCTION public.get_vdp_filter_options(
  p_client_id text,
  p_from date,
  p_to date
)
RETURNS TABLE (
  years     text[],
  makes     text[],
  models    text[],
  locations text[],
  types     text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH base AS (
    SELECT
      NULLIF(TRIM(inv_year), '') AS inv_year,
      NULLIF(TRIM(inv_make), '') AS inv_make,
      NULLIF(TRIM(inv_model), '') AS inv_model,
      NULLIF(TRIM(inv_location), '') AS inv_location,
      NULLIF(TRIM(inv_type), '') AS inv_type
    FROM smart_final_data
    WHERE client_id::text = trim(p_client_id)
      AND report_date BETWEEN p_from AND p_to
  )
  SELECT
    COALESCE((
      SELECT array_agg(DISTINCT b.inv_year ORDER BY b.inv_year DESC)
      FROM base b
      WHERE b.inv_year ~ '^\d{4}$'
    ), ARRAY[]::text[]) AS years,
    COALESCE((
      SELECT array_agg(DISTINCT b.inv_make ORDER BY b.inv_make)
      FROM base b
      WHERE b.inv_make IS NOT NULL
    ), ARRAY[]::text[]) AS makes,
    COALESCE((
      SELECT array_agg(DISTINCT b.inv_model ORDER BY b.inv_model)
      FROM base b
      WHERE b.inv_model IS NOT NULL
    ), ARRAY[]::text[]) AS models,
    COALESCE((
      SELECT array_agg(DISTINCT b.inv_location ORDER BY b.inv_location)
      FROM base b
      WHERE b.inv_location IS NOT NULL
    ), ARRAY[]::text[]) AS locations,
    COALESCE((
      SELECT array_agg(DISTINCT b.inv_type ORDER BY b.inv_type)
      FROM base b
      WHERE b.inv_type IS NOT NULL
    ), ARRAY[]::text[]) AS types;
$$;

GRANT EXECUTE ON FUNCTION public.get_vdp_filter_options(text, date, date)
  TO anon, authenticated, service_role;
