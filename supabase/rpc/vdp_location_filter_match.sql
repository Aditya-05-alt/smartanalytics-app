-- Helper: location filter match for VDP inventory rows.
-- Blank / Unknown inv_location matches when the dealer has exactly ONE
-- row in smart_dealer_locations and that name is in p_locations.
-- Deploy before updating RPCs that filter by p_locations.

CREATE OR REPLACE FUNCTION public.vdp_location_filter_match(
  p_client_id text,
  p_inv_location text,
  p_locations text[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(array_length(p_locations, 1), 0) = 0
    OR TRIM(COALESCE(p_inv_location, '')) = ANY (
      SELECT TRIM(loc) FROM unnest(p_locations) AS loc
    )
    OR (
      (
        NULLIF(TRIM(COALESCE(p_inv_location, '')), '') IS NULL
        OR LOWER(TRIM(p_inv_location)) = 'unknown'
      )
      AND (
        SELECT COUNT(*)::int
        FROM public.smart_dealer_locations dl
        WHERE dl.customer_id::text = trim(p_client_id)
          AND TRIM(dl.location_name) <> ''
      ) = 1
      AND EXISTS (
        SELECT 1
        FROM public.smart_dealer_locations dl
        WHERE dl.customer_id::text = trim(p_client_id)
          AND TRIM(dl.location_name) = ANY (
            SELECT TRIM(loc) FROM unnest(p_locations) AS loc
          )
      )
    );
$$;

REVOKE ALL ON FUNCTION public.vdp_location_filter_match(text, text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vdp_location_filter_match(text, text, text[])
  TO anon, authenticated, service_role;
