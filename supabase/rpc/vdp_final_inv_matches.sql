-- Shared inventory filter for VDP channel→final joins (avoids TRIM in EXISTS).
-- Returns true when no inventory filters are active OR the final row matches.

CREATE OR REPLACE FUNCTION public.vdp_final_inv_matches(
  p_client_id text,
  p_inv_type text,
  p_inv_make text,
  p_inv_model text,
  p_inv_location text,
  p_inv_year text,
  p_inv_condition text,
  p_types text[],
  p_makes text[],
  p_models text[],
  p_locations text[],
  p_years integer[],
  p_condition text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (COALESCE(array_length(p_types, 1), 0) = 0 OR p_inv_type = ANY(p_types))
    AND (COALESCE(array_length(p_makes, 1), 0) = 0 OR p_inv_make = ANY(p_makes))
    AND (COALESCE(array_length(p_models, 1), 0) = 0 OR p_inv_model = ANY(p_models))
    AND (
      COALESCE(array_length(p_locations, 1), 0) = 0
      OR public.vdp_location_filter_match(trim(p_client_id), p_inv_location, p_locations)
    )
    AND (
      COALESCE(array_length(p_years, 1), 0) = 0
      OR (p_inv_year ~ '^\d{4}$' AND p_inv_year::int = ANY(p_years))
    )
    AND (
      UPPER(COALESCE(p_condition, 'BOTH')) = 'BOTH'
      OR UPPER(p_inv_condition) = UPPER(p_condition)
    );
$$;

GRANT EXECUTE ON FUNCTION public.vdp_final_inv_matches(
  text, text, text, text, text, text, text,
  text[], text[], text[], text[], integer[], text
) TO anon, authenticated, service_role;
