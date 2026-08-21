-- Location breakdown. Channel filter: sum GA4 page views joined to final inventory.

DROP FUNCTION IF EXISTS public.get_location_breakdown(text, date, date);
DROP FUNCTION IF EXISTS public.get_location_breakdown(
  text, date, date, text[], text[], text, text[], integer[], text[], text[]
);
DROP FUNCTION IF EXISTS public.get_location_breakdown(
  text, date, date, int, text[], text[], text[], text[], integer[], text
);
DROP FUNCTION IF EXISTS public.get_location_breakdown(
  text, date, date, int, text[], text[], text[], text[], integer[], text, text[]
);

CREATE OR REPLACE FUNCTION public.get_location_breakdown(
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
  p_channels text[] DEFAULT NULL
)
RETURNS TABLE (
  location_bucket text,
  views bigint,
  pct numeric,
  rank int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '55s'
AS $$
  WITH base AS (
    SELECT
      COALESCE(NULLIF(TRIM(f.inv_location), ''), 'Unknown') AS location_bucket,
      COALESCE(p.views, 0)::bigint AS views
    FROM public.smart_ga4_page_data p
    INNER JOIN public.smart_final_data f
      ON f.client_id::text = p.client_id::text
     AND f.report_date = p.report_date
     AND f.page_path = p.page_path
    WHERE COALESCE(array_length(p_channels, 1), 0) > 0
      AND p.client_id::text = trim(p_client_id)
      AND p.report_date BETWEEN p_from AND p_to
      AND p.vdp_conditions IS TRUE
      AND public.vdp_channel_matches(p.channel, p_channels)
      AND (COALESCE(array_length(p_types, 1), 0) = 0 OR f.inv_type = ANY(p_types))
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

    UNION ALL

    SELECT
      COALESCE(NULLIF(TRIM(inv_location), ''), 'Unknown') AS location_bucket,
      COALESCE(views, 0)::bigint AS views
    FROM public.smart_final_data
    WHERE COALESCE(array_length(p_channels, 1), 0) = 0
      AND client_id::text = trim(p_client_id)
      AND report_date BETWEEN p_from AND p_to
      AND (COALESCE(array_length(p_types, 1), 0) = 0 OR inv_type = ANY(p_types))
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
      AND public.vdp_condition_matches(inv_condition, p_condition)
  ),
  agg AS (
    SELECT location_bucket, SUM(views)::bigint AS views
    FROM base
    GROUP BY location_bucket
  ),
  ranked AS (
    SELECT
      location_bucket,
      views,
      ROW_NUMBER() OVER (ORDER BY views DESC, location_bucket) AS rn
    FROM agg
  ),
  top_n AS (
    SELECT location_bucket, views, rn::int AS rank
    FROM ranked
    WHERE p_limit IS NULL OR rn <= p_limit
  ),
  other_bucket AS (
    SELECT
      'Other'::text AS location_bucket,
      COALESCE(SUM(views), 0)::bigint AS views,
      999::int AS rank
    FROM ranked
    WHERE p_limit IS NOT NULL AND rn > p_limit
    HAVING COALESCE(SUM(views), 0) > 0
  ),
  combined AS (
    SELECT * FROM top_n
    UNION ALL
    SELECT * FROM other_bucket
  ),
  grand AS (
    SELECT NULLIF(SUM(views), 0)::numeric AS total
    FROM combined
  )
  SELECT
    c.location_bucket,
    c.views,
    ROUND(100.0 * c.views / g.total, 2) AS pct,
    c.rank
  FROM combined c
  CROSS JOIN grand g
  ORDER BY c.rank;
$$;

REVOKE ALL ON FUNCTION public.get_location_breakdown(
  text, date, date, int, text[], text[], text[], text[], integer[], text, text[]
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_location_breakdown(
  text, date, date, int, text[], text[], text[], text[], integer[], text, text[]
) TO anon, authenticated, service_role;
