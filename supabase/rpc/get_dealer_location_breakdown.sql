-- Location breakdown: smart_dealer_locations + smart_ga4_page_data (VDP views).
-- Same page grain as get_ga4_channel_breakdown (channel lives on page rows).
-- Inventory filters join via smart_final_data paths. Does NOT replace get_location_breakdown.
-- Deploy smart_dealer_locations.sql first. Run in Supabase SQL editor.

DROP FUNCTION IF EXISTS public.get_dealer_location_breakdown(
  text, date, date, int, text[], text[], text[], text[], integer[], text
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
  v_filter_active boolean;
  v_condition text := UPPER(COALESCE(p_condition, 'BOTH'));
BEGIN
  v_filter_active :=
       COALESCE(array_length(p_types, 1), 0)     > 0
    OR COALESCE(array_length(p_makes, 1), 0)     > 0
    OR COALESCE(array_length(p_models, 1), 0)    > 0
    OR v_condition <> 'BOTH'
    OR COALESCE(array_length(p_years, 1), 0)     > 0
    OR COALESCE(array_length(p_locations, 1), 0) > 0;

  RETURN QUERY
  WITH dealer_locs AS (
    SELECT
      dl.id,
      dl.sort_order,
      CASE
        WHEN NULLIF(TRIM(dl.location_number), '') IS NOT NULL
        THEN TRIM(dl.location_number) || ' - ' || TRIM(dl.location_name)
        ELSE TRIM(dl.location_name)
      END AS location_bucket,
      COALESCE(NULLIF(TRIM(dl.inv_match_value), ''), TRIM(dl.location_name)) AS inv_match_value,
      COALESCE(
        NULLIF(TRIM(dl.page_match_value), ''),
        NULLIF(TRIM(dl.inv_match_value), ''),
        TRIM(dl.location_name)
      ) AS page_match_value
    FROM public.smart_dealer_locations dl
    WHERE dl.client_id::text = trim(p_client_id)
      AND dl.is_active IS TRUE
      AND (
        COALESCE(array_length(p_locations, 1), 0) = 0
        OR TRIM(dl.location_name) = ANY(SELECT TRIM(loc) FROM unnest(p_locations) AS loc)
        OR COALESCE(NULLIF(TRIM(dl.inv_match_value), ''), TRIM(dl.location_name))
             = ANY(SELECT TRIM(loc) FROM unnest(p_locations) AS loc)
      )
  ),
  pages AS (
    SELECT
      p.client_id,
      p.report_date,
      TRIM(p.page_path) AS page_path,
      p.page_location,
      COALESCE(p.views, 0)::bigint AS views
    FROM public.smart_ga4_page_data p
    WHERE p.client_id::text = trim(p_client_id)
      AND p.report_date BETWEEN p_from AND p_to
      AND p.ga4_page_type ILIKE 'VDP%'
  ),
  filtered_final AS (
    SELECT DISTINCT
      s.client_id,
      s.report_date,
      TRIM(s.page_path) AS page_path,
      TRIM(s.inv_location) AS inv_location
    FROM public.smart_final_data s
    WHERE s.client_id::text = trim(p_client_id)
      AND s.report_date BETWEEN p_from AND p_to
      AND (COALESCE(array_length(p_types, 1), 0) = 0 OR s.inv_type = ANY(p_types))
      AND (COALESCE(array_length(p_makes, 1), 0) = 0 OR s.inv_make = ANY(p_makes))
      AND (COALESCE(array_length(p_models, 1), 0) = 0 OR s.inv_model = ANY(p_models))
      AND (
        COALESCE(array_length(p_locations, 1), 0) = 0
        OR TRIM(s.inv_location) = ANY(SELECT TRIM(loc) FROM unnest(p_locations) AS loc)
      )
      AND (
        COALESCE(array_length(p_years, 1), 0) = 0
        OR (s.inv_year ~ '^\d{4}$' AND s.inv_year::int = ANY(p_years))
      )
      AND (
        v_condition = 'BOTH'
        OR UPPER(s.inv_condition) = v_condition
      )
  ),
  eligible_pages AS (
    SELECT p.client_id, p.report_date, p.page_path, p.page_location, p.views
    FROM pages p
    WHERE NOT v_filter_active

    UNION ALL

    SELECT p.client_id, p.report_date, p.page_path, p.page_location, p.views
    FROM pages p
    WHERE v_filter_active
      AND EXISTS (
        SELECT 1
        FROM filtered_final f
        WHERE f.client_id::text = p.client_id::text
          AND f.report_date = p.report_date
          AND (
            p.page_path = f.page_path
            OR (
              COALESCE(p.page_path, '') <> ''
              AND COALESCE(f.page_path, '') <> ''
              AND LOWER(TRIM(p.page_location)) LIKE '%' || LOWER(p.page_path) || '%'
            )
            OR (
              COALESCE(p.page_path, '') <> ''
              AND EXISTS (
                SELECT 1
                FROM public.smart_final_data s2
                WHERE s2.client_id::text = p.client_id::text
                  AND s2.report_date = p.report_date
                  AND TRIM(s2.page_path) = f.page_path
                  AND LOWER(TRIM(s2.page_location)) LIKE '%' || LOWER(p.page_path) || '%'
              )
            )
          )
      )
  ),
  assigned AS (
    SELECT
      COALESCE(loc_pick.location_bucket, 'Other') AS location_bucket,
      ep.views
    FROM eligible_pages ep
    LEFT JOIN LATERAL (
      SELECT dl.location_bucket
      FROM dealer_locs dl
      WHERE
        ep.page_path = TRIM(dl.page_match_value)
        OR LOWER(COALESCE(ep.page_location, '')) LIKE '%' || LOWER(dl.page_match_value) || '%'
        OR LOWER(COALESCE(ep.page_path, '')) LIKE '%' || LOWER(dl.page_match_value) || '%'
        OR EXISTS (
          SELECT 1
          FROM filtered_final f
          WHERE f.client_id::text = ep.client_id::text
            AND f.report_date = ep.report_date
            AND f.page_path = ep.page_path
            AND f.inv_location = dl.inv_match_value
        )
        OR (
          NOT v_filter_active
          AND EXISTS (
            SELECT 1
            FROM public.smart_final_data s
            WHERE s.client_id::text = ep.client_id::text
              AND s.report_date = ep.report_date
              AND TRIM(s.page_path) = ep.page_path
              AND TRIM(s.inv_location) = dl.inv_match_value
          )
        )
      ORDER BY dl.sort_order, dl.id
      LIMIT 1
    ) loc_pick ON TRUE
  ),
  agg AS (
    SELECT a.location_bucket, SUM(a.views)::bigint AS views
    FROM assigned a
    GROUP BY a.location_bucket
  ),
  ranked AS (
    SELECT
      ag.location_bucket,
      ag.views,
      ROW_NUMBER() OVER (ORDER BY ag.views DESC, ag.location_bucket) AS rn
    FROM agg ag
    WHERE ag.views > 0
  ),
  top_n AS (
    SELECT r.location_bucket, r.views, r.rn::int AS rank
    FROM ranked r
    WHERE p_limit IS NULL OR r.rn <= p_limit
  ),
  other_bucket AS (
    SELECT
      'Other'::text AS location_bucket,
      COALESCE(SUM(r.views), 0)::bigint AS views,
      999::int AS rank
    FROM ranked r
    WHERE p_limit IS NOT NULL AND r.rn > p_limit
    HAVING COALESCE(SUM(r.views), 0) > 0
  ),
  combined AS (
    SELECT * FROM top_n
    UNION ALL
    SELECT * FROM other_bucket
  ),
  grand AS (
    SELECT NULLIF(SUM(c.views), 0)::numeric AS total
    FROM combined c
  )
  SELECT
    c.location_bucket,
    c.views,
    ROUND(100.0 * c.views / g.total, 2) AS pct,
    c.rank
  FROM combined c
  CROSS JOIN grand g
  ORDER BY c.rank;
END;
$$;

REVOKE ALL ON FUNCTION public.get_dealer_location_breakdown(
  text, date, date, int, text[], text[], text[], text[], integer[], text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_dealer_location_breakdown(
  text, date, date, int, text[], text[], text[], text[], integer[], text
) TO anon, authenticated, service_role;
