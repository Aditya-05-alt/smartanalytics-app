-- Soft location identity + filter match for VDP.
-- Fixes dealers where dropdown label ≠ inventory spelling
-- (e.g. "Waco, TX" vs "Waco TX") without changing the filter contract.
-- Deploy BEFORE get_vdp_filter_options / breakdown RPCs that use this helper.

CREATE OR REPLACE FUNCTION public.vdp_location_identity(p_location text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT NULLIF(
    trim(
      both FROM regexp_replace(
        regexp_replace(
          lower(
            trim(
              both FROM translate(
                coalesce(p_location, ''),
                E'’‘`´',
                E''''''
              )
            )
          ),
          '[,]+',
          ' ',
          'g'
        ),
        '\s+',
        ' ',
        'g'
      )
    ),
    ''
  );
$$;

COMMENT ON FUNCTION public.vdp_location_identity(text) IS
  'Normalize location for soft match: lower, strip curly quotes, commas→spaces, collapse whitespace.';

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
    -- Exact (legacy)
    OR TRIM(COALESCE(p_inv_location, '')) = ANY (
      SELECT TRIM(loc) FROM unnest(p_locations) AS loc
    )
    -- Soft identity: "City, ST" ≡ "City ST", accents/quotes ignored
    OR (
      public.vdp_location_identity(p_inv_location) IS NOT NULL
      AND public.vdp_location_identity(p_inv_location) = ANY (
        SELECT public.vdp_location_identity(loc)
        FROM unnest(p_locations) AS loc
        WHERE NULLIF(TRIM(loc), '') IS NOT NULL
      )
    )
    -- Blank / Unknown → single configured store location (unchanged)
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
          AND (
            TRIM(dl.location_name) = ANY (
              SELECT TRIM(loc) FROM unnest(p_locations) AS loc
            )
            OR public.vdp_location_identity(dl.location_name) = ANY (
              SELECT public.vdp_location_identity(loc)
              FROM unnest(p_locations) AS loc
              WHERE NULLIF(TRIM(loc), '') IS NOT NULL
            )
          )
      )
    );
$$;

REVOKE ALL ON FUNCTION public.vdp_location_identity(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vdp_location_identity(text)
  TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.vdp_location_filter_match(text, text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vdp_location_filter_match(text, text, text[])
  TO anon, authenticated, service_role;
