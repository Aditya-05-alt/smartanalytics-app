-- Distinct inventory dimension rows for VDP filter dropdowns (respects active filters).
-- When p_channels is set, only rows with matching GA4 VDP traffic are included.

CREATE OR REPLACE FUNCTION public.vdp_filter_inventory_pool(
  p_client_id text,
  p_from date,
  p_to date,
  p_types text[] DEFAULT NULL,
  p_makes text[] DEFAULT NULL,
  p_models text[] DEFAULT NULL,
  p_locations text[] DEFAULT NULL,
  p_years integer[] DEFAULT NULL,
  p_condition text DEFAULT 'BOTH',
  p_channels text[] DEFAULT NULL,
  p_ga4_property_id text DEFAULT NULL
)
RETURNS TABLE (
  inv_year text,
  inv_make text,
  inv_model text,
  inv_location text,
  inv_type text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT
    NULLIF(TRIM(f.inv_year), '') AS inv_year,
    NULLIF(TRIM(f.inv_make), '') AS inv_make,
    NULLIF(TRIM(f.inv_model), '') AS inv_model,
    NULLIF(TRIM(f.inv_location), '') AS inv_location,
    COALESCE(
      NULLIF(TRIM(f.inv_custom_type), ''),
      NULLIF(TRIM(f.inv_type), '')
    ) AS inv_type
  FROM public.smart_ga4_page_data p
  INNER JOIN public.smart_final_data f
    ON f.client_id::text = p.client_id::text
   AND f.report_date = p.report_date
   AND f.page_path = p.page_path
   AND public.ga4_property_scope_matches(f.ga4_property_id, p.ga4_property_id)
  WHERE COALESCE(array_length(p_channels, 1), 0) > 0
    AND p.client_id::text = trim(p_client_id)
    AND public.ga4_property_scope_matches(p.ga4_property_id, p_ga4_property_id)
    AND p.report_date BETWEEN p_from AND p_to
    AND p.vdp_conditions IS TRUE
    AND public.vdp_channel_matches(p.channel, p_channels)
    AND (
      COALESCE(array_length(p_types, 1), 0) = 0
      OR COALESCE(
        NULLIF(TRIM(f.inv_custom_type), ''),
        NULLIF(TRIM(f.inv_type), '')
      ) = ANY(p_types)
    )
    AND (COALESCE(array_length(p_makes, 1), 0) = 0 OR f.inv_make = ANY(p_makes))
    AND (COALESCE(array_length(p_models, 1), 0) = 0 OR f.inv_model = ANY(p_models))
    AND (
      COALESCE(array_length(p_locations, 1), 0) = 0
      OR public.vdp_location_filter_match(trim(p_client_id), f.inv_location, p_locations)
    )
    AND (
      COALESCE(array_length(p_years, 1), 0) = 0
      OR (f.inv_year ~ '^\d{4}$' AND f.inv_year::int = ANY(p_years))
    )
    AND public.vdp_condition_matches(f.inv_condition, p_condition)

  UNION

  SELECT DISTINCT
    NULLIF(TRIM(inv_year), '') AS inv_year,
    NULLIF(TRIM(inv_make), '') AS inv_make,
    NULLIF(TRIM(inv_model), '') AS inv_model,
    NULLIF(TRIM(inv_location), '') AS inv_location,
    COALESCE(
      NULLIF(TRIM(inv_custom_type), ''),
      NULLIF(TRIM(inv_type), '')
    ) AS inv_type
  FROM public.smart_final_data
  WHERE COALESCE(array_length(p_channels, 1), 0) = 0
    AND client_id::text = trim(p_client_id)
    AND public.ga4_property_scope_matches(ga4_property_id, p_ga4_property_id)
    AND report_date BETWEEN p_from AND p_to
    AND (
      COALESCE(array_length(p_types, 1), 0) = 0
      OR COALESCE(
        NULLIF(TRIM(inv_custom_type), ''),
        NULLIF(TRIM(inv_type), '')
      ) = ANY(p_types)
    )
    AND (COALESCE(array_length(p_makes, 1), 0) = 0 OR inv_make = ANY(p_makes))
    AND (COALESCE(array_length(p_models, 1), 0) = 0 OR inv_model = ANY(p_models))
    AND (
      COALESCE(array_length(p_locations, 1), 0) = 0
      OR public.vdp_location_filter_match(trim(p_client_id), inv_location, p_locations)
    )
    AND (
      COALESCE(array_length(p_years, 1), 0) = 0
      OR (inv_year ~ '^\d{4}$' AND inv_year::int = ANY(p_years))
    )
    AND public.vdp_condition_matches(inv_condition, p_condition);
$$;

GRANT EXECUTE ON FUNCTION public.vdp_filter_inventory_pool(
  text, date, date, text[], text[], text[], text[], integer[], text, text[], text
) TO anon, authenticated, service_role;
