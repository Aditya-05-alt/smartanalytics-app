-- Location breakdown for dashboard (run in Supabase SQL Editor).
-- Fixes empty [] from the browser: anon cannot read smart_final_data via RLS unless
-- this function is SECURITY DEFINER (same pattern as get_ga4_overview).
--
-- Drop legacy 3-arg overload if PostgREST reports ambiguity:
-- DROP FUNCTION IF EXISTS public.get_location_breakdown(text, date, date);

DROP FUNCTION IF EXISTS public.get_location_breakdown(
  text, date, date, text[], text[], text, text[], integer[], text[], text[]
);

CREATE OR REPLACE FUNCTION public.get_location_breakdown(
  p_client_id text,
  p_from date,
  p_to date,
  p_types text[] DEFAULT NULL,
  p_classes text[] DEFAULT NULL,
  p_condition text DEFAULT NULL,
  p_makes text[] DEFAULT NULL,
  p_years integer[] DEFAULT NULL,
  p_locations text[] DEFAULT NULL,
  p_channels text[] DEFAULT NULL
)
RETURNS TABLE (
  location_bucket text,
  views bigint,
  pct numeric,
  rank integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH filtered AS (
    SELECT
      COALESCE(NULLIF(TRIM(inv_location), ''), 'Unknown') AS loc,
      COALESCE(views, 0)::bigint AS v
    FROM smart_final_data
    WHERE client_id::text = trim(p_client_id)
      AND report_date >= p_from
      AND report_date <= p_to
  ),
  agg AS (
    SELECT loc, SUM(v) AS views
    FROM filtered
    WHERE v > 0
    GROUP BY loc
  ),
  ranked AS (
    SELECT
      loc,
      views,
      ROW_NUMBER() OVER (ORDER BY views DESC, loc) AS rn,
      SUM(views) OVER () AS total_views
    FROM agg
  ),
  top5 AS (
    SELECT loc, views, rn, total_views FROM ranked WHERE rn <= 5
  ),
  other_row AS (
    SELECT COALESCE(SUM(views), 0)::bigint AS views
    FROM ranked
    WHERE rn > 5
  )
  SELECT
    t.loc::text AS location_bucket,
    t.views,
    ROUND((t.views::numeric / NULLIF(t.total_views, 0)) * 100, 2) AS pct,
    t.rn::integer AS rank
  FROM top5 t
  UNION ALL
  SELECT
    'Other'::text,
    o.views,
    ROUND((o.views::numeric / NULLIF((SELECT total_views FROM ranked LIMIT 1), 0)) * 100, 2),
    999
  FROM other_row o
  WHERE o.views > 0
  ORDER BY rank;
$$;

REVOKE ALL ON FUNCTION public.get_location_breakdown(
  text, date, date, text[], text[], text, text[], integer[], text[], text[]
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_location_breakdown(
  text, date, date, text[], text[], text, text[], integer[], text[], text[]
) TO anon, authenticated;
