-- LAB ONLY — wrapper over get_location_breakdown_lab.
-- Same single-location Unknown remap as get_dealer_location_breakdown.
-- Deploy after get_location_breakdown_lab.sql.

DROP FUNCTION IF EXISTS public.get_dealer_location_breakdown_lab(
  text, date, date, int, text[], text[], text[], text[], integer[], text
);

CREATE OR REPLACE FUNCTION public.get_dealer_location_breakdown_lab(
  p_client_id text,
  p_from date,
  p_to date,
  p_limit int DEFAULT NULL,
  p_types text[] DEFAULT NULL,
  p_makes text[] DEFAULT NULL,
  p_models text[] DEFAULT NULL,
  p_locations text[] DEFAULT NULL,
  p_years integer[] DEFAULT NULL,
  p_condition text DEFAULT 'BOTH'
)
RETURNS TABLE (
  location_bucket text,
  views bigint,
  pct numeric,
  rank int
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_loc_count int;
  v_single_location text;
BEGIN
  SELECT
    COUNT(*)::int,
    MIN(TRIM(dl.location_name))
  INTO v_loc_count, v_single_location
  FROM public.smart_dealer_locations dl
  WHERE dl.customer_id::text = trim(p_client_id)
    AND TRIM(dl.location_name) <> '';

  IF COALESCE(v_loc_count, 0) <> 1 THEN
    RETURN QUERY
    SELECT * FROM public.get_location_breakdown_lab(
      p_client_id, p_from, p_to, p_limit,
      p_types, p_makes, p_models, p_locations, p_years, p_condition
    );
    RETURN;
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      CASE
        WHEN LOWER(TRIM(lb.location_bucket)) IN ('unknown', '')
          THEN v_single_location
        ELSE lb.location_bucket
      END AS location_bucket,
      lb.views
    FROM public.get_location_breakdown_lab(
      p_client_id, p_from, p_to, p_limit,
      p_types, p_makes, p_models, p_locations, p_years, p_condition
    ) lb
  ),
  agg AS (
    SELECT b.location_bucket, SUM(b.views)::bigint AS views
    FROM base b
    GROUP BY b.location_bucket
  ),
  ranked AS (
    SELECT
      a.location_bucket,
      a.views,
      ROW_NUMBER() OVER (ORDER BY a.views DESC, a.location_bucket)::int AS rank
    FROM agg a
    WHERE a.views > 0
  ),
  grand AS (
    SELECT NULLIF(SUM(r.views), 0)::numeric AS total
    FROM ranked r
  )
  SELECT
    r.location_bucket,
    r.views,
    ROUND(100.0 * r.views / g.total, 2) AS pct,
    r.rank
  FROM ranked r
  CROSS JOIN grand g
  ORDER BY r.rank;
END;
$$;

COMMENT ON FUNCTION public.get_dealer_location_breakdown_lab(
  text, date, date, int, text[], text[], text[], text[], integer[], text
) IS
  'VDP Lab dealer location breakdown. Live get_dealer_location_breakdown untouched.';

REVOKE ALL ON FUNCTION public.get_dealer_location_breakdown_lab(
  text, date, date, int, text[], text[], text[], text[], integer[], text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_dealer_location_breakdown_lab(
  text, date, date, int, text[], text[], text[], text[], integer[], text
) TO anon, authenticated, service_role;
