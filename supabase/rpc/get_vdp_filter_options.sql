-- Distinct VDP filter dropdown values for a dealer + date range.
-- Locations match Location Breakdown:
--   1) If smart_dealer_locations has rows → those only
--   2) Else → inv_location that end with a real US state code (City, ST / City ST)
-- Deploy in Supabase SQL editor (required for server RPC path).

DROP FUNCTION IF EXISTS public.get_vdp_filter_options(text, date, date);
DROP FUNCTION IF EXISTS public.get_vdp_filter_options(
  text, date, date, text[], text[], text[], text[], integer[], text
);

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
  WITH us_states AS (
    SELECT unnest(ARRAY[
      'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID',
      'IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO',
      'MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA',
      'RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'
    ]) AS st
  ),
  base AS (
    SELECT
      NULLIF(TRIM(inv_year), '') AS inv_year,
      NULLIF(TRIM(inv_make), '') AS inv_make,
      NULLIF(TRIM(inv_model), '') AS inv_model,
      NULLIF(TRIM(inv_location), '') AS inv_location,
      COALESCE(
        NULLIF(TRIM(inv_custom_type), ''),
        NULLIF(TRIM(inv_type), '')
      ) AS inv_type
    FROM smart_final_data
    WHERE client_id::text = trim(p_client_id)
      AND report_date BETWEEN p_from AND p_to
  ),
  configured_locs AS (
    SELECT DISTINCT TRIM(dl.location_name) AS location_name
    FROM public.smart_dealer_locations dl
    WHERE dl.customer_id::text = trim(p_client_id)
      AND TRIM(dl.location_name) <> ''
  ),
  clean_inv_locs AS (
    SELECT DISTINCT b.inv_location AS location_name
    FROM base b
    WHERE b.inv_location IS NOT NULL
      AND LOWER(b.inv_location) <> 'unknown'
      AND length(b.inv_location) BETWEEN 4 AND 60
      AND b.inv_location !~ '[\^\*]'
      AND b.inv_location !~ '[\u4e00-\u9fff]'
      AND b.inv_location !~* '(dealership|inventory|explore|trusted|models|selection|latest|multi[- ]?state|for sale|motorhomes?|campers?|trailers?|\bdeals\b|\bsales\b)'
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
      )
  ),
  all_locs AS (
    SELECT c.location_name FROM configured_locs c
    WHERE EXISTS (SELECT 1 FROM configured_locs)

    UNION ALL

    SELECT i.location_name FROM clean_inv_locs i
    WHERE NOT EXISTS (SELECT 1 FROM configured_locs)
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
      SELECT array_agg(DISTINCT a.location_name ORDER BY a.location_name)
      FROM all_locs a
    ), ARRAY[]::text[]) AS locations,
    COALESCE((
      SELECT array_agg(DISTINCT b.inv_type ORDER BY b.inv_type)
      FROM base b
      WHERE b.inv_type IS NOT NULL
    ), ARRAY[]::text[]) AS types;
$$;

GRANT EXECUTE ON FUNCTION public.get_vdp_filter_options(text, date, date)
  TO anon, authenticated, service_role;
