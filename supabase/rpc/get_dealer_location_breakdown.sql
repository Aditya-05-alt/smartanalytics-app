-- Thin wrapper over get_location_breakdown.
-- If dealer has exactly ONE row in smart_dealer_locations, rename blank/Other/Unknown → that name.
-- Forwards p_channels so channel filter matches other inventory breakdowns.
-- Always keeps the same view total as get_location_breakdown (no dropped buckets).

DROP FUNCTION IF EXISTS public.get_dealer_location_breakdown(
  text, date, date, int, text[], text[], text[], text[], integer[], text
);
DROP FUNCTION IF EXISTS public.get_dealer_location_breakdown(
  text, date, date, int, text[], text[], text[], text[], integer[], text, text
);
DROP FUNCTION IF EXISTS public.get_dealer_location_breakdown(
  text, date, date, int, text[], text[], text[], text[], integer[], text, text[], text
);

CREATE OR REPLACE FUNCTION public.get_dealer_location_breakdown(
  p_client_id text,
  p_from date,
  p_to date,
  p_limit int DEFAULT NULL,
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

  -- 0 or 2+ configured names → exact location breakdown (same total as other charts).
  IF COALESCE(v_loc_count, 0) <> 1 THEN
    RETURN QUERY
    SELECT * FROM public.get_location_breakdown(
      p_client_id, p_from, p_to, p_limit,
      p_types, p_makes, p_models, p_locations, p_years, p_condition,
      p_channels, p_ga4_property_id
    );
    RETURN;
  END IF;

  -- Exactly one hardcoded name: remap blank/Other/Unknown → that name.
  RETURN QUERY
  WITH base AS (
    SELECT
      CASE
        WHEN LOWER(TRIM(lb.location_bucket)) IN ('unknown', 'other', '')
          THEN v_single_location
        ELSE lb.location_bucket
      END AS location_bucket,
      lb.views
    FROM public.get_location_breakdown(
      p_client_id, p_from, p_to, p_limit,
      p_types, p_makes, p_models, p_locations, p_years, p_condition,
      p_channels, p_ga4_property_id
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

REVOKE ALL ON FUNCTION public.get_dealer_location_breakdown(
  text, date, date, int, text[], text[], text[], text[], integer[], text, text[], text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_dealer_location_breakdown(
  text, date, date, int, text[], text[], text[], text[], integer[], text, text[], text
) TO anon, authenticated, service_role;
