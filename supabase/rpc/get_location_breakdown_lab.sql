-- LAB ONLY — /dashboard/vdp-lab location breakdown.
-- Same filter contract as live get_location_breakdown, plus explicit
-- vdp_location_filter_match (already used live). Kept separate so Lab can
-- evolve without touching production.
-- Deploy in Supabase SQL editor (after vdp_location_filter_match.sql).

DROP FUNCTION IF EXISTS public.get_location_breakdown_lab(text, date, date);
DROP FUNCTION IF EXISTS public.get_location_breakdown_lab(
  text, date, date, int, text[], text[], text[], text[], integer[], text
);

CREATE OR REPLACE FUNCTION public.get_location_breakdown_lab(
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
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH base AS (
    SELECT
      COALESCE(NULLIF(TRIM(s.inv_location), ''), 'Unknown') AS location_bucket,
      COALESCE(s.views, 0)::bigint AS views
    FROM public.smart_final_data s
    WHERE s.client_id::text = trim(p_client_id)
      AND s.report_date BETWEEN p_from AND p_to
      AND (COALESCE(array_length(p_types, 1), 0) = 0 OR s.inv_type = ANY(p_types))
      AND (COALESCE(array_length(p_makes, 1), 0) = 0 OR s.inv_make = ANY(p_makes))
      AND (COALESCE(array_length(p_models, 1), 0) = 0 OR s.inv_model = ANY(p_models))
      AND public.vdp_location_filter_match(trim(p_client_id), s.inv_location, p_locations)
      AND (
        COALESCE(array_length(p_years, 1), 0) = 0
        OR (s.inv_year ~ '^\d{4}$' AND s.inv_year::int = ANY(p_years))
      )
      AND (
        UPPER(COALESCE(p_condition, 'BOTH')) = 'BOTH'
        OR UPPER(s.inv_condition) = UPPER(p_condition)
      )
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

COMMENT ON FUNCTION public.get_location_breakdown_lab(
  text, date, date, int, text[], text[], text[], text[], integer[], text
) IS
  'VDP Lab location breakdown from smart_final_data. Live get_location_breakdown untouched.';

REVOKE ALL ON FUNCTION public.get_location_breakdown_lab(
  text, date, date, int, text[], text[], text[], text[], integer[], text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_location_breakdown_lab(
  text, date, date, int, text[], text[], text[], text[], integer[], text
) TO anon, authenticated, service_role;
