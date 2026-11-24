-- Medium breakdown: one row per GA4 session medium (no "Other" rollup).
-- Same inventory / channel / scale contract as get_ga4_channel_breakdown.
-- Default page type VDP (Overview Medium panel).

DROP FUNCTION IF EXISTS public.get_ga4_medium_breakdown(
  text, date, date, text, text[], text[], text[], text, text[], text[], integer[], text[], text, text[]
);
DROP FUNCTION IF EXISTS public.get_ga4_medium_breakdown(
  text, date, date, text, text[], text[], text[], text, text[], text[], integer[], text[], text
);

CREATE OR REPLACE FUNCTION public.get_ga4_medium_breakdown(
  p_client_id   text,
  p_from        date,
  p_to          date,
  p_page_type   text      DEFAULT 'VDP',
  p_channels    text[]    DEFAULT NULL,
  p_types       text[]    DEFAULT NULL,
  p_classes     text[]    DEFAULT NULL,
  p_condition   text      DEFAULT 'BOTH',
  p_makes       text[]    DEFAULT NULL,
  p_models      text[]    DEFAULT NULL,
  p_years       integer[] DEFAULT NULL,
  p_locations   text[]    DEFAULT NULL,
  p_ga4_property_id text DEFAULT NULL,
  p_mediums     text[]    DEFAULT NULL
)
RETURNS TABLE (
  medium_bucket text,
  views          bigint,
  pct            numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '55s'
AS $$
DECLARE
  v_filter_active boolean;
  v_page_type     text := UPPER(COALESCE(p_page_type, 'VDP'));
  v_condition     text := UPPER(COALESCE(p_condition, 'BOTH'));
  v_client        text := trim(p_client_id);
  v_scale_to_final boolean;
BEGIN
  v_filter_active :=
       COALESCE(array_length(p_types, 1), 0)     > 0
    OR COALESCE(array_length(p_classes, 1), 0)   > 0
    OR v_condition <> 'BOTH'
    OR COALESCE(array_length(p_makes, 1), 0)     > 0
    OR COALESCE(array_length(p_models, 1), 0)    > 0
    OR COALESCE(array_length(p_years, 1), 0)     > 0
    OR COALESCE(array_length(p_locations, 1), 0) > 0;

  v_scale_to_final :=
    v_page_type = 'VDP'
    AND v_filter_active
    AND (p_channels IS NULL OR COALESCE(array_length(p_channels, 1), 0) = 0)
    AND (p_mediums IS NULL OR COALESCE(array_length(p_mediums, 1), 0) = 0);

  IF NOT v_filter_active THEN
    RETURN QUERY
    WITH base AS (
      SELECT p.medium, p.views::bigint AS views
      FROM smart_ga4_page_data p
      WHERE p.client_id::text = v_client
        AND p.report_date BETWEEN p_from AND p_to
        AND public.ga4_property_scope_matches(p.ga4_property_id, p_ga4_property_id)
        AND (
          v_page_type = 'ALL'
          OR (v_page_type = 'VDP'   AND p.vdp_conditions IS TRUE)
          OR (v_page_type = 'SRP'   AND p.ga4_page_type = 'SRP')
          OR (v_page_type = 'HOME'  AND p.ga4_page_type ILIKE 'home%')
          OR (v_page_type = 'OTHER' AND p.vdp_conditions IS NOT TRUE
                                    AND p.ga4_page_type <> 'SRP'
                                    AND p.ga4_page_type NOT ILIKE 'home%')
        )
        AND (p_channels IS NULL OR array_length(p_channels, 1) = 0
             OR public.vdp_channel_matches(p.channel, p_channels))
        AND (p_mediums IS NULL OR array_length(p_mediums, 1) = 0
             OR public.vdp_medium_matches(p.medium, p_mediums))
    ),
    mapped AS (
      SELECT public.vdp_medium_key(b.medium) AS medium_bucket, b.views
      FROM base b
    ),
    agg AS (
      SELECT m.medium_bucket, SUM(m.views)::bigint AS views
      FROM mapped m
      GROUP BY m.medium_bucket
    ),
    grand AS (
      SELECT NULLIF(SUM(a.views), 0)::numeric AS total FROM agg a
    )
    SELECT
      a.medium_bucket,
      a.views,
      ROUND(100.0 * a.views / g.total, 2) AS pct
    FROM agg a
    CROSS JOIN grand g
    WHERE a.views > 0
    ORDER BY a.views DESC, a.medium_bucket;
    RETURN;
  END IF;

  RETURN QUERY
  WITH filtered_final AS (
    SELECT
      s.client_id::text AS client_id,
      s.report_date,
      TRIM(s.page_path) AS page_path,
      SUM(COALESCE(s.views, 0))::bigint AS views
    FROM smart_final_data s
    WHERE s.client_id::text = v_client
      AND s.report_date BETWEEN p_from AND p_to
      AND (
        COALESCE(array_length(p_types, 1), 0) = 0
        OR s.inv_type = ANY(p_types)
        OR NULLIF(TRIM(s.inv_custom_type), '') = ANY(p_types)
      )
      AND (COALESCE(array_length(p_makes, 1), 0) = 0 OR s.inv_make = ANY(p_makes))
      AND (COALESCE(array_length(p_models, 1), 0) = 0 OR s.inv_model = ANY(p_models))
      AND (
        COALESCE(array_length(p_locations, 1), 0) = 0
        OR public.vdp_location_filter_match(v_client, s.inv_location, p_locations)
      )
      AND (
        COALESCE(array_length(p_years, 1), 0) = 0
        OR (s.inv_year ~ '^\d{4}$' AND s.inv_year::int = ANY(p_years))
      )
      AND public.vdp_condition_matches(s.inv_condition, p_condition)
      AND (
        COALESCE(array_length(p_classes, 1), 0) = 0
        OR (
          ('Class A' = ANY(p_classes) AND s.inv_type ILIKE '%class a%') OR
          ('Class B' = ANY(p_classes) AND s.inv_type ILIKE '%class b%') OR
          ('Class C' = ANY(p_classes) AND s.inv_type ILIKE '%class c%') OR
          ('Towable' = ANY(p_classes) AND (
              s.inv_type ILIKE '%travel trailer%'
           OR s.inv_type ILIKE '%fifth wheel%'
           OR s.inv_type ILIKE '%toy hauler%'
           OR s.inv_type ILIKE '%pop-up%'))
        )
      )
    GROUP BY s.client_id, s.report_date, TRIM(s.page_path)
  ),
  final_kpi AS (
    SELECT COALESCE(SUM(f.views), 0)::bigint AS total
    FROM filtered_final f
  ),
  pages AS (
    SELECT
      p.medium,
      p.views::bigint AS views,
      p.client_id::text AS client_id,
      p.report_date,
      TRIM(p.page_path) AS page_path,
      p.vdp_conditions
    FROM smart_ga4_page_data p
    WHERE p.client_id::text = v_client
      AND p.report_date BETWEEN p_from AND p_to
      AND public.ga4_property_scope_matches(p.ga4_property_id, p_ga4_property_id)
      AND (
        v_page_type = 'ALL'
        OR (v_page_type = 'VDP'   AND p.vdp_conditions IS TRUE)
        OR (v_page_type = 'SRP'   AND p.ga4_page_type = 'SRP')
        OR (v_page_type = 'HOME'  AND p.ga4_page_type ILIKE 'home%')
        OR (v_page_type = 'OTHER' AND p.vdp_conditions IS NOT TRUE
                                  AND p.ga4_page_type <> 'SRP'
                                  AND p.ga4_page_type NOT ILIKE 'home%')
      )
      AND (p_channels IS NULL OR array_length(p_channels, 1) = 0
           OR public.vdp_channel_matches(p.channel, p_channels))
      AND (p_mediums IS NULL OR array_length(p_mediums, 1) = 0
           OR public.vdp_medium_matches(p.medium, p_mediums))
  ),
  combined AS (
    SELECT p.medium, p.views
    FROM pages p
    WHERE v_page_type <> 'VDP'
      AND p.vdp_conditions IS NOT TRUE

    UNION ALL

    SELECT p.medium, p.views
    FROM pages p
    INNER JOIN filtered_final f
      ON f.client_id = p.client_id
     AND f.report_date = p.report_date
     AND f.page_path = p.page_path
    WHERE p.vdp_conditions IS TRUE
  ),
  mapped AS (
    SELECT public.vdp_medium_key(c.medium) AS medium_bucket, c.views
    FROM combined c
  ),
  raw_agg AS (
    SELECT m.medium_bucket, SUM(m.views)::bigint AS views
    FROM mapped m
    GROUP BY m.medium_bucket
  ),
  raw_total AS (
    SELECT COALESCE(SUM(r.views), 0)::bigint AS total FROM raw_agg r
  ),
  scaled AS (
    SELECT
      r.medium_bucket,
      CASE
        WHEN v_scale_to_final AND (SELECT total FROM raw_total) > 0 THEN
          ROUND(
            r.views::numeric * (SELECT total FROM final_kpi)::numeric
              / (SELECT total FROM raw_total)::numeric
          )::bigint
        ELSE
          r.views
      END AS views
    FROM raw_agg r
  ),
  with_fallback AS (
    SELECT s.medium_bucket, s.views FROM scaled s
    WHERE s.views > 0

    UNION ALL

    SELECT '(none)'::text, (SELECT total FROM final_kpi)
    WHERE v_scale_to_final
      AND (SELECT total FROM final_kpi) > 0
      AND NOT EXISTS (SELECT 1 FROM scaled s WHERE s.views > 0)
  ),
  drift_fixed AS (
    SELECT
      w.medium_bucket,
      CASE
        WHEN v_scale_to_final
          AND w.medium_bucket = (
            SELECT w2.medium_bucket
            FROM with_fallback w2
            ORDER BY w2.views DESC, w2.medium_bucket
            LIMIT 1
          )
        THEN w.views
             + (SELECT total FROM final_kpi)
             - (SELECT COALESCE(SUM(w3.views), 0)::bigint FROM with_fallback w3)
        ELSE w.views
      END AS views
    FROM with_fallback w
  ),
  agg AS (
    SELECT d.medium_bucket, d.views
    FROM drift_fixed d
    WHERE d.views > 0
  ),
  grand AS (
    SELECT NULLIF(SUM(a.views), 0)::numeric AS total FROM agg a
  )
  SELECT
    a.medium_bucket,
    a.views,
    ROUND(100.0 * a.views / g.total, 2) AS pct
  FROM agg a
  CROSS JOIN grand g
  WHERE a.views > 0
  ORDER BY a.views DESC, a.medium_bucket;
END;
$$;

COMMENT ON FUNCTION public.get_ga4_medium_breakdown(
  text, date, date, text, text[], text[], text[], text, text[], text[], integer[], text[], text, text[]
) IS
  'Medium breakdown. Unfiltered = GA4. Filtered VDP = GA4 medium mix scaled to Final KPI total.';

REVOKE ALL ON FUNCTION public.get_ga4_medium_breakdown(
  text, date, date, text, text[], text[], text[], text, text[], text[], integer[], text[], text, text[]
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_ga4_medium_breakdown(
  text, date, date, text, text[], text[], text[], text, text[], text[], integer[], text[], text, text[]
) TO anon, authenticated, service_role;
