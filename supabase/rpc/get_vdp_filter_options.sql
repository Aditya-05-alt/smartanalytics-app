-- Distinct VDP filter dropdown values for a dealer + date range.
-- Cascading: each dimension excludes its own active filter (exclude-self).
-- Requires: vdp_filter_inventory_pool.sql, vdp_location_filter_match.sql

DROP FUNCTION IF EXISTS public.get_vdp_filter_options(text, date, date);
DROP FUNCTION IF EXISTS public.get_vdp_filter_options(
  text, date, date, text[], text[], text[], text[], integer[], text
);
DROP FUNCTION IF EXISTS public.get_vdp_filter_options(
  text, date, date, text[], text[], text[], text[], integer[], text, text[], text
);

CREATE OR REPLACE FUNCTION public.get_vdp_filter_options(
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
  years                 text[],
  makes                 text[],
  models                text[],
  locations             text[],
  types                 text[],
  configured_locations  text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH us_states AS (
    SELECT unnest(ARRAY[
      'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID',
      'IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO',
      'MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA',
      'RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'
    ]) AS st
  ),
  pool_years AS (
    SELECT * FROM public.vdp_filter_inventory_pool(
      p_client_id, p_from, p_to,
      p_types, p_makes, p_models, p_locations, NULL, p_condition, p_channels, p_ga4_property_id
    )
  ),
  pool_makes AS (
    SELECT * FROM public.vdp_filter_inventory_pool(
      p_client_id, p_from, p_to,
      p_types, NULL, p_models, p_locations, p_years, p_condition, p_channels, p_ga4_property_id
    )
  ),
  pool_models AS (
    SELECT * FROM public.vdp_filter_inventory_pool(
      p_client_id, p_from, p_to,
      p_types, p_makes, NULL, p_locations, p_years, p_condition, p_channels, p_ga4_property_id
    )
  ),
  pool_types AS (
    SELECT * FROM public.vdp_filter_inventory_pool(
      p_client_id, p_from, p_to,
      NULL, p_makes, p_models, p_locations, p_years, p_condition, p_channels, p_ga4_property_id
    )
  ),
  pool_locations AS (
    SELECT * FROM public.vdp_filter_inventory_pool(
      p_client_id, p_from, p_to,
      p_types, p_makes, p_models, NULL, p_years, p_condition, p_channels, p_ga4_property_id
    )
  ),
  configured_locs AS (
    SELECT DISTINCT TRIM(dl.location_name) AS location_name
    FROM public.smart_dealer_locations dl
    WHERE dl.customer_id::text = trim(p_client_id)
      AND TRIM(dl.location_name) <> ''
  ),
  clean_inv_locs AS (
    SELECT DISTINCT b.inv_location AS location_name
    FROM pool_locations b
    WHERE b.inv_location IS NOT NULL
      AND LOWER(b.inv_location) <> 'unknown'
      AND length(b.inv_location) BETWEEN 4 AND 60
      AND b.inv_location !~ '[\^\*]'
      AND b.inv_location !~ '[\u4e00-\u9fff]'
      AND b.inv_location !~* '(dealership|inventory|explore|trusted|models|selection|latest|multi[- ]?state|for sale|motorhomes?|campers?|trailers?|\bdeals\b|\bsales\b|\brv\s*world\b|\bautocaravanas?\b|\bmundo de\b|gerzenyjev|\bavtodom|\bsvet\b|search for|your next|new\s*&\s*used|sky\s*river)'
      AND (
        (
          b.inv_location ~* ',\s*[A-Za-z]{2}$'
          AND UPPER(substring(b.inv_location from ',\s*([A-Za-z]{2})$')) IN (SELECT st FROM us_states)
        )
        OR (
          b.inv_location ~* '\s[A-Za-z]{2}$'
          AND b.inv_location !~* ',\s*[A-Za-z]{2}$'
          AND UPPER(substring(b.inv_location from '\s([A-Za-z]{2})$')) IN (SELECT st FROM us_states)
        )
        OR (
          b.inv_location ~* '^[A-Za-z][A-Za-z .''-]{1,40}$'
          AND b.inv_location !~* '\s[A-Za-z]{2}$'
          AND b.inv_location !~* ',\s*'
          AND b.inv_location !~* '\brv\b'
          AND b.inv_location !~* 'gerzeny|sky\s*river'
        )
        OR (
          b.inv_location ~* ',\s*(florida|floride|texas|arkansas|missouri|georgia|alabama|california|californie)$'
        )
      )
  ),
  fallback_inv_locs AS (
    SELECT DISTINCT b.inv_location AS location_name
    FROM pool_locations b
    WHERE b.inv_location IS NOT NULL
      AND LOWER(b.inv_location) <> 'unknown'
      AND length(b.inv_location) BETWEEN 2 AND 80
      AND b.inv_location !~ '[\^\*]'
      AND b.inv_location !~ '[\u4e00-\u9fff]'
      AND b.inv_location !~* '(dealership|inventory|explore|trusted|models|selection|latest|multi[- ]?state|for sale|motorhomes?|campers?|trailers?|\bdeals\b|\bsales\b|http|www\.|\.com|\brv\s*world\b|\bautocaravanas?\b|\bmundo de\b|gerzenyjev|\bavtodom|\bsvet\b|search for|your next|gerzeny|new\s*&\s*used|sky\s*river)'
  ),
  all_locs AS (
    SELECT c.location_name FROM configured_locs c
    WHERE c.location_name !~* '(\brv\s*world\b|\bautocaravanas?\b|\bmundo de\b|gerzenyjev|\bavtodom|\bsvet\b|search for|your next|dealership|\bdeals\b|inventory|new\s*&\s*used|sky\s*river)'
      AND NOT (
        c.location_name ~* 'gerzeny'
        AND c.location_name !~* ',\s*[A-Za-z]{2}$'
      )
      AND EXISTS (
        SELECT 1 FROM pool_locations p
        WHERE public.vdp_location_filter_match(trim(p_client_id), p.inv_location, ARRAY[c.location_name])
      )

    UNION

    SELECT i.location_name FROM clean_inv_locs i

    UNION

    SELECT f.location_name FROM fallback_inv_locs f
    WHERE NOT EXISTS (SELECT 1 FROM clean_inv_locs)
  )
  SELECT
    COALESCE((
      SELECT array_agg(DISTINCT b.inv_year ORDER BY b.inv_year DESC)
      FROM pool_years b
      WHERE b.inv_year ~ '^\d{4}$'
    ), ARRAY[]::text[]) AS years,
    COALESCE((
      SELECT array_agg(DISTINCT b.inv_make ORDER BY b.inv_make)
      FROM pool_makes b
      WHERE b.inv_make IS NOT NULL
    ), ARRAY[]::text[]) AS makes,
    COALESCE((
      SELECT array_agg(DISTINCT b.inv_model ORDER BY b.inv_model)
      FROM pool_models b
      WHERE b.inv_model IS NOT NULL
    ), ARRAY[]::text[]) AS models,
    COALESCE((
      SELECT array_agg(DISTINCT a.location_name ORDER BY a.location_name)
      FROM all_locs a
    ), ARRAY[]::text[]) AS locations,
    COALESCE((
      SELECT array_agg(DISTINCT b.inv_type ORDER BY b.inv_type)
      FROM pool_types b
      WHERE b.inv_type IS NOT NULL
    ), ARRAY[]::text[]) AS types,
    COALESCE((
      SELECT array_agg(DISTINCT c.location_name ORDER BY c.location_name)
      FROM configured_locs c
    ), ARRAY[]::text[]) AS configured_locations;
$$;

GRANT EXECUTE ON FUNCTION public.get_vdp_filter_options(
  text, date, date, text[], text[], text[], text[], integer[], text, text[], text
) TO anon, authenticated, service_role;
