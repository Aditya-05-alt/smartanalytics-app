-- Overview Medium filter + breakdown (GA4 medium).
-- Adds p_mediums to KPI / inventory / channel RPCs and Medium breakdown panel.
-- Normalize GA4 medium labels for VDP filter matching
-- ("Organic" ≡ "organic", "(none)" ≡ empty / null).

CREATE OR REPLACE FUNCTION public.vdp_medium_key(p_medium text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(btrim(COALESCE(NULLIF(btrim(COALESCE(p_medium, '')), ''), '(none)')));
$$;

CREATE OR REPLACE FUNCTION public.vdp_medium_matches(
  p_medium text,
  p_mediums text[]
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    COALESCE(array_length(p_mediums, 1), 0) = 0
    OR public.vdp_medium_key(p_medium) = ANY (
      SELECT public.vdp_medium_key(m)
      FROM unnest(p_mediums) AS m
    );
$$;

-- True when a final-data VDP row has GA4 page traffic in any selected medium.
CREATE OR REPLACE FUNCTION public.vdp_final_matches_mediums(
  p_client_id text,
  p_report_date date,
  p_page_path text,
  p_mediums text[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(array_length(p_mediums, 1), 0) = 0
    OR EXISTS (
      SELECT 1
      FROM public.smart_ga4_page_data p
      WHERE p.client_id::text = trim(p_client_id)
        AND p.report_date = p_report_date
        AND TRIM(COALESCE(p.page_path, '')) = TRIM(COALESCE(p_page_path, ''))
        AND p.vdp_conditions IS TRUE
        AND public.vdp_medium_matches(p.medium, p_mediums)
    );
$$;

GRANT EXECUTE ON FUNCTION public.vdp_medium_key(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.vdp_medium_matches(text, text[]) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.vdp_final_matches_mediums(text, date, text, text[])
  TO anon, authenticated, service_role;


-- Distinct GA4 mediums for VDP filter dropdown (ordered by views desc).

DROP FUNCTION IF EXISTS public.get_vdp_medium_options(text, date, date);
DROP FUNCTION IF EXISTS public.get_vdp_medium_options(text, date, date, text);

CREATE OR REPLACE FUNCTION public.get_vdp_medium_options(
  p_client_id text,
  p_from date,
  p_to date,
  p_ga4_property_id text DEFAULT NULL
)
RETURNS TABLE (
  medium text,
  views bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '30s'
AS $$
  SELECT
    public.vdp_medium_key(p.medium) AS medium,
    SUM(COALESCE(p.views, 0))::bigint AS views
  FROM public.smart_ga4_page_data p
  WHERE p.client_id::text = trim(p_client_id)
    AND p.report_date BETWEEN p_from AND p_to
    AND public.ga4_property_scope_matches(p.ga4_property_id, p_ga4_property_id)
    AND p.vdp_conditions IS TRUE
  GROUP BY 1
  HAVING SUM(COALESCE(p.views, 0)) > 0
  ORDER BY views DESC, medium;
$$;

REVOKE ALL ON FUNCTION public.get_vdp_medium_options(text, date, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_vdp_medium_options(text, date, date, text)
  TO anon, authenticated, service_role;


-- Fast VDP KPI total.
-- No channel/medium → smart_final_data (or unfiltered GA4 when no inventory).
-- With channel and/or medium → sum smart_ga4_page_data.views, optional inventory via path join.

DROP FUNCTION IF EXISTS public.get_vdp_views_total(text, date, date);
DROP FUNCTION IF EXISTS public.get_vdp_views_total(text, date, date, text[], text[], text[], text[], integer[], text);
DROP FUNCTION IF EXISTS public.get_vdp_views_total(text, date, date, text[], text[], text[], text[], integer[], text, text[]);
DROP FUNCTION IF EXISTS public.get_vdp_views_total(text, date, date, text[], text[], text[], text[], integer[], text, text[], text[]);

CREATE OR REPLACE FUNCTION public.get_vdp_views_total(
  p_client_id text,
  p_from date,
  p_to date,
  p_types text[] DEFAULT NULL,
  p_makes text[] DEFAULT NULL,
  p_models text[] DEFAULT NULL,
  p_locations text[] DEFAULT NULL,
  p_years integer[] DEFAULT NULL,
  p_condition text DEFAULT 'BOTH',
  p_channels text[] DEFAULT NULL,
  p_mediums text[] DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '55s'
AS $$
DECLARE
  v_client text := trim(p_client_id);
  v_condition text := UPPER(COALESCE(p_condition, 'BOTH'));
  v_inv boolean;
  v_traffic boolean;
  v_total bigint;
BEGIN
  v_inv :=
       COALESCE(array_length(p_types, 1), 0) > 0
    OR COALESCE(array_length(p_makes, 1), 0) > 0
    OR COALESCE(array_length(p_models, 1), 0) > 0
    OR COALESCE(array_length(p_locations, 1), 0) > 0
    OR COALESCE(array_length(p_years, 1), 0) > 0
    OR v_condition <> 'BOTH';

  v_traffic :=
       COALESCE(array_length(p_channels, 1), 0) > 0
    OR COALESCE(array_length(p_mediums, 1), 0) > 0;

  IF v_traffic THEN
    IF NOT v_inv THEN
      SELECT COALESCE(SUM(COALESCE(p.views, 0)), 0)::bigint
      INTO v_total
      FROM public.smart_ga4_page_data p
      WHERE p.client_id::text = v_client
        AND p.report_date BETWEEN p_from AND p_to
        AND p.vdp_conditions IS TRUE
        AND (COALESCE(array_length(p_channels, 1), 0) = 0
             OR public.vdp_channel_matches(p.channel, p_channels))
        AND (COALESCE(array_length(p_mediums, 1), 0) = 0
             OR public.vdp_medium_matches(p.medium, p_mediums));
    ELSE
      SELECT COALESCE(SUM(COALESCE(p.views, 0)), 0)::bigint
      INTO v_total
      FROM public.smart_ga4_page_data p
      WHERE p.client_id::text = v_client
        AND p.report_date BETWEEN p_from AND p_to
        AND p.vdp_conditions IS TRUE
        AND (COALESCE(array_length(p_channels, 1), 0) = 0
             OR public.vdp_channel_matches(p.channel, p_channels))
        AND (COALESCE(array_length(p_mediums, 1), 0) = 0
             OR public.vdp_medium_matches(p.medium, p_mediums))
        AND EXISTS (
          SELECT 1
          FROM public.smart_final_data f
          WHERE f.client_id::text = v_client
            AND f.report_date = p.report_date
            AND f.page_path = public.ga4_effective_page_path(p.page_path, p.page_path_q_s)
            AND (
              COALESCE(array_length(p_types, 1), 0) = 0
              OR f.inv_type = ANY(p_types)
              OR NULLIF(TRIM(f.inv_custom_type), '') = ANY(p_types)
            )
            AND (COALESCE(array_length(p_makes, 1), 0) = 0 OR f.inv_make = ANY(p_makes))
            AND (COALESCE(array_length(p_models, 1), 0) = 0 OR f.inv_model = ANY(p_models))
            AND (
              COALESCE(array_length(p_locations, 1), 0) = 0
              OR public.vdp_location_filter_match(v_client, f.inv_location, p_locations)
            )
            AND (
              COALESCE(array_length(p_years, 1), 0) = 0
              OR (f.inv_year ~ '^\d{4}$' AND f.inv_year::int = ANY(p_years))
            )
            AND public.vdp_condition_matches(f.inv_condition, p_condition)
        );
    END IF;
    RETURN COALESCE(v_total, 0);
  END IF;

  IF NOT v_inv THEN
    SELECT COALESCE(SUM(COALESCE(p.views, 0)), 0)::bigint
    INTO v_total
    FROM public.smart_ga4_page_data p
    WHERE p.client_id::text = v_client
      AND p.report_date BETWEEN p_from AND p_to
      AND p.vdp_conditions IS TRUE;
    RETURN COALESCE(v_total, 0);
  END IF;

  SELECT COALESCE(SUM(COALESCE(f.views, 0)), 0)::bigint
  INTO v_total
  FROM public.smart_final_data f
  WHERE f.client_id::text = v_client
    AND f.report_date BETWEEN p_from AND p_to
    AND (COALESCE(array_length(p_types, 1), 0) = 0 OR f.inv_type = ANY(p_types)
         OR NULLIF(TRIM(f.inv_custom_type), '') = ANY(p_types))
    AND (COALESCE(array_length(p_makes, 1), 0) = 0 OR f.inv_make = ANY(p_makes))
    AND (COALESCE(array_length(p_models, 1), 0) = 0 OR f.inv_model = ANY(p_models))
    AND (
      COALESCE(array_length(p_locations, 1), 0) = 0
      OR public.vdp_location_filter_match(v_client, f.inv_location, p_locations)
    )
    AND (
      COALESCE(array_length(p_years, 1), 0) = 0
      OR (f.inv_year ~ '^\d{4}$' AND f.inv_year::int = ANY(p_years))
    )
    AND public.vdp_condition_matches(f.inv_condition, p_condition);

  RETURN COALESCE(v_total, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.get_vdp_views_total(
  text, date, date, text[], text[], text[], text[], integer[], text, text[], text[]
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_vdp_views_total(
  text, date, date, text[], text[], text[], text[], integer[], text, text[], text[]
) TO anon, authenticated, service_role;


-- Fast VDP daily series (same channel/medium strategy as get_vdp_views_total).

DROP FUNCTION IF EXISTS public.get_vdp_views_by_date(text, date, date);
DROP FUNCTION IF EXISTS public.get_vdp_views_by_date(text, date, date, text[], text[], text[], text[], integer[], text);
DROP FUNCTION IF EXISTS public.get_vdp_views_by_date(text, date, date, text[], text[], text[], text[], integer[], text, text[]);
DROP FUNCTION IF EXISTS public.get_vdp_views_by_date(text, date, date, text[], text[], text[], text[], integer[], text, text[], text[]);

CREATE OR REPLACE FUNCTION public.get_vdp_views_by_date(
  p_client_id text,
  p_from date,
  p_to date,
  p_types text[] DEFAULT NULL,
  p_makes text[] DEFAULT NULL,
  p_models text[] DEFAULT NULL,
  p_locations text[] DEFAULT NULL,
  p_years integer[] DEFAULT NULL,
  p_condition text DEFAULT 'BOTH',
  p_channels text[] DEFAULT NULL,
  p_mediums text[] DEFAULT NULL
)
RETURNS TABLE (
  report_date date,
  views bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '55s'
AS $$
DECLARE
  v_client text := trim(p_client_id);
  v_condition text := UPPER(COALESCE(p_condition, 'BOTH'));
  v_inv boolean;
  v_traffic boolean;
BEGIN
  v_inv :=
       COALESCE(array_length(p_types, 1), 0) > 0
    OR COALESCE(array_length(p_makes, 1), 0) > 0
    OR COALESCE(array_length(p_models, 1), 0) > 0
    OR COALESCE(array_length(p_locations, 1), 0) > 0
    OR COALESCE(array_length(p_years, 1), 0) > 0
    OR v_condition <> 'BOTH';

  v_traffic :=
       COALESCE(array_length(p_channels, 1), 0) > 0
    OR COALESCE(array_length(p_mediums, 1), 0) > 0;

  IF v_traffic THEN
    IF NOT v_inv THEN
      RETURN QUERY
      SELECT
        p.report_date,
        COALESCE(SUM(COALESCE(p.views, 0)), 0)::bigint AS views
      FROM public.smart_ga4_page_data p
      WHERE p.client_id::text = v_client
        AND p.report_date BETWEEN p_from AND p_to
        AND p.vdp_conditions IS TRUE
        AND (COALESCE(array_length(p_channels, 1), 0) = 0
             OR public.vdp_channel_matches(p.channel, p_channels))
        AND (COALESCE(array_length(p_mediums, 1), 0) = 0
             OR public.vdp_medium_matches(p.medium, p_mediums))
      GROUP BY p.report_date
      ORDER BY p.report_date;
    ELSE
      RETURN QUERY
      SELECT
        p.report_date,
        COALESCE(SUM(COALESCE(p.views, 0)), 0)::bigint AS views
      FROM public.smart_ga4_page_data p
      WHERE p.client_id::text = v_client
        AND p.report_date BETWEEN p_from AND p_to
        AND p.vdp_conditions IS TRUE
        AND (COALESCE(array_length(p_channels, 1), 0) = 0
             OR public.vdp_channel_matches(p.channel, p_channels))
        AND (COALESCE(array_length(p_mediums, 1), 0) = 0
             OR public.vdp_medium_matches(p.medium, p_mediums))
        AND EXISTS (
          SELECT 1
          FROM public.smart_final_data f
          WHERE f.client_id::text = v_client
            AND f.report_date = p.report_date
            AND f.page_path = public.ga4_effective_page_path(p.page_path, p.page_path_q_s)
            AND (
              COALESCE(array_length(p_types, 1), 0) = 0
              OR f.inv_type = ANY(p_types)
              OR NULLIF(TRIM(f.inv_custom_type), '') = ANY(p_types)
            )
            AND (COALESCE(array_length(p_makes, 1), 0) = 0 OR f.inv_make = ANY(p_makes))
            AND (COALESCE(array_length(p_models, 1), 0) = 0 OR f.inv_model = ANY(p_models))
            AND (
              COALESCE(array_length(p_locations, 1), 0) = 0
              OR public.vdp_location_filter_match(v_client, f.inv_location, p_locations)
            )
            AND (
              COALESCE(array_length(p_years, 1), 0) = 0
              OR (f.inv_year ~ '^\d{4}$' AND f.inv_year::int = ANY(p_years))
            )
            AND public.vdp_condition_matches(f.inv_condition, p_condition)
        )
      GROUP BY p.report_date
      ORDER BY p.report_date;
    END IF;
    RETURN;
  END IF;

  IF NOT v_inv THEN
    RETURN QUERY
    SELECT
      p.report_date,
      COALESCE(SUM(COALESCE(p.views, 0)), 0)::bigint AS views
    FROM public.smart_ga4_page_data p
    WHERE p.client_id::text = v_client
      AND p.report_date BETWEEN p_from AND p_to
      AND p.vdp_conditions IS TRUE
    GROUP BY p.report_date
    ORDER BY p.report_date;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    f.report_date,
    COALESCE(SUM(COALESCE(f.views, 0)), 0)::bigint AS views
  FROM public.smart_final_data f
  WHERE f.client_id::text = v_client
    AND f.report_date BETWEEN p_from AND p_to
    AND (
      COALESCE(array_length(p_types, 1), 0) = 0
      OR f.inv_type = ANY(p_types)
      OR NULLIF(TRIM(f.inv_custom_type), '') = ANY(p_types)
    )
    AND (COALESCE(array_length(p_makes, 1), 0) = 0 OR f.inv_make = ANY(p_makes))
    AND (COALESCE(array_length(p_models, 1), 0) = 0 OR f.inv_model = ANY(p_models))
    AND (
      COALESCE(array_length(p_locations, 1), 0) = 0
      OR public.vdp_location_filter_match(v_client, f.inv_location, p_locations)
    )
    AND (
      COALESCE(array_length(p_years, 1), 0) = 0
      OR (f.inv_year ~ '^\d{4}$' AND f.inv_year::int = ANY(p_years))
    )
    AND public.vdp_condition_matches(f.inv_condition, p_condition)
  GROUP BY f.report_date
  ORDER BY f.report_date;
END;
$$;

REVOKE ALL ON FUNCTION public.get_vdp_views_by_date(
  text, date, date, text[], text[], text[], text[], integer[], text, text[], text[]
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_vdp_views_by_date(
  text, date, date, text[], text[], text[], text[], integer[], text, text[], text[]
) TO anon, authenticated, service_role;


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


-- Channel breakdown: one row per GA4 session channel (no "Other" rollup).
-- Fast path when no inventory filters.
-- Filtered VDP path: channel mix from GA4 path whitelist, but TOTAL scaled to
-- match get_vdp_views_total (smart_final_data) so KPI and donut never diverge.
-- Deploy via migration / Supabase SQL.

DROP FUNCTION IF EXISTS public.get_ga4_channel_breakdown(text, date, date, text);
DROP FUNCTION IF EXISTS public.get_ga4_channel_breakdown(
  text, date, date, text, text[], text[], text[], text, text[], text[], integer[], text[]
);
DROP FUNCTION IF EXISTS public.get_ga4_channel_breakdown(
  text, date, date, text, text[], text[], text[], text, text[], text[], integer[], text[], text
);
DROP FUNCTION IF EXISTS public.get_ga4_channel_breakdown(
  text, date, date, text, text[], text[], text[], text, text[], text[], integer[], text[], text, text[]
);

CREATE OR REPLACE FUNCTION public.get_ga4_channel_breakdown(
  p_client_id   text,
  p_from        date,
  p_to          date,
  p_page_type   text      DEFAULT 'ALL',
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
  channel_bucket text,
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
  v_page_type     text := UPPER(COALESCE(p_page_type, 'ALL'));
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

  -- Scale only when VDP inventory filters are on and no channel filter
  -- (KPI then uses Final; with channel selected KPI uses GA4 path join).
  v_scale_to_final :=
    v_page_type = 'VDP'
    AND v_filter_active
    AND (p_channels IS NULL OR COALESCE(array_length(p_channels, 1), 0) = 0)
    AND (p_mediums IS NULL OR COALESCE(array_length(p_mediums, 1), 0) = 0);

  -- Fast path: no inventory filters — aggregate smart_ga4_page_data only.
  IF NOT v_filter_active THEN
    RETURN QUERY
    WITH base AS (
      SELECT p.channel, p.views::bigint AS views
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
      SELECT
        CASE lower(trim(COALESCE(b.channel, '')))
          WHEN 'organic_search'  THEN 'Organic Search'
          WHEN 'paid_search'     THEN 'Paid Search'
          WHEN 'direct'          THEN 'Direct'
          WHEN 'organic_social'  THEN 'Organic Social'
          WHEN 'paid_social'     THEN 'Paid Social'
          WHEN 'paid_video'      THEN 'Paid Video'
          WHEN 'organic_video'   THEN 'Organic Video'
          WHEN 'display'         THEN 'Display'
          WHEN 'email'           THEN 'Email'
          WHEN 'referral'        THEN 'Referral'
          WHEN 'affiliates'      THEN 'Affiliates'
          WHEN 'paid_other'      THEN 'Paid Other'
          WHEN 'sms'             THEN 'SMS'
          WHEN 'audio'           THEN 'Audio'
          WHEN 'cross-network'   THEN 'Cross-network'
          WHEN 'unassigned'      THEN 'Unassigned'
          WHEN ''                THEN '(not set)'
          ELSE initcap(replace(replace(lower(trim(b.channel)), '_', ' '), '-', ' '))
        END AS channel_bucket,
        b.views
      FROM base b
    ),
    agg AS (
      SELECT m.channel_bucket, SUM(m.views)::bigint AS views
      FROM mapped m
      GROUP BY m.channel_bucket
    ),
    grand AS (
      SELECT NULLIF(SUM(a.views), 0)::numeric AS total FROM agg a
    )
    SELECT
      a.channel_bucket,
      a.views,
      ROUND(100.0 * a.views / g.total, 2) AS pct
    FROM agg a
    CROSS JOIN grand g
    WHERE a.views > 0
    ORDER BY a.views DESC, a.channel_bucket;
    RETURN;
  END IF;

  -- Filtered path.
  -- VDP: scale GA4 channel mix so Σ channels = Final KPI (get_vdp_views_total).
  -- Other page types: keep prior path-whitelist on GA4 views.
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
    -- Same grain as get_vdp_views_total inventory branch (no vdp_conditions gate).
    SELECT COALESCE(SUM(f.views), 0)::bigint AS total
    FROM filtered_final f
  ),
  pages AS (
    SELECT
      p.channel,
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
    -- Non-VDP pages (ALL/OTHER tabs): keep unfiltered GA4 rows.
    SELECT p.channel, p.views
    FROM pages p
    WHERE v_page_type <> 'VDP'
      AND p.vdp_conditions IS NOT TRUE

    UNION ALL

    -- VDP (or VDP rows inside ALL): path must exist in filtered Final.
    SELECT p.channel, p.views
    FROM pages p
    INNER JOIN filtered_final f
      ON f.client_id = p.client_id
     AND f.report_date = p.report_date
     AND f.page_path = p.page_path
    WHERE p.vdp_conditions IS TRUE
  ),
  mapped AS (
    SELECT
      CASE lower(trim(COALESCE(c.channel, '')))
        WHEN 'organic_search'  THEN 'Organic Search'
        WHEN 'paid_search'     THEN 'Paid Search'
        WHEN 'direct'          THEN 'Direct'
        WHEN 'organic_social'  THEN 'Organic Social'
        WHEN 'paid_social'     THEN 'Paid Social'
        WHEN 'paid_video'      THEN 'Paid Video'
        WHEN 'organic_video'   THEN 'Organic Video'
        WHEN 'display'         THEN 'Display'
        WHEN 'email'           THEN 'Email'
        WHEN 'referral'        THEN 'Referral'
        WHEN 'affiliates'      THEN 'Affiliates'
        WHEN 'paid_other'      THEN 'Paid Other'
        WHEN 'sms'             THEN 'SMS'
        WHEN 'audio'           THEN 'Audio'
        WHEN 'cross-network'   THEN 'Cross-network'
        WHEN 'unassigned'      THEN 'Unassigned'
        WHEN ''                THEN '(not set)'
        ELSE initcap(replace(replace(lower(trim(c.channel)), '_', ' '), '-', ' '))
      END AS channel_bucket,
      c.views
    FROM combined c
  ),
  raw_agg AS (
    SELECT m.channel_bucket, SUM(m.views)::bigint AS views
    FROM mapped m
    GROUP BY m.channel_bucket
  ),
  raw_total AS (
    SELECT COALESCE(SUM(r.views), 0)::bigint AS total FROM raw_agg r
  ),
  -- VDP + inventory: scale channel mix to Final KPI total (exact match with top card).
  scaled AS (
    SELECT
      r.channel_bucket,
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
  -- If VDP Final has views but no GA4 channel rows matched, emit Unassigned.
  with_fallback AS (
    SELECT s.channel_bucket, s.views FROM scaled s
    WHERE s.views > 0

    UNION ALL

    SELECT 'Unassigned'::text, (SELECT total FROM final_kpi)
    WHERE v_scale_to_final
      AND (SELECT total FROM final_kpi) > 0
      AND NOT EXISTS (SELECT 1 FROM scaled s WHERE s.views > 0)
  ),
  -- Fix ROUND drift so Σ channels == Final KPI on VDP.
  drift_fixed AS (
    SELECT
      w.channel_bucket,
      CASE
        WHEN v_scale_to_final
          AND w.channel_bucket = (
            SELECT w2.channel_bucket
            FROM with_fallback w2
            ORDER BY w2.views DESC, w2.channel_bucket
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
    SELECT d.channel_bucket, d.views
    FROM drift_fixed d
    WHERE d.views > 0
  ),
  grand AS (
    SELECT NULLIF(SUM(a.views), 0)::numeric AS total FROM agg a
  )
  SELECT
    a.channel_bucket,
    a.views,
    ROUND(100.0 * a.views / g.total, 2) AS pct
  FROM agg a
  CROSS JOIN grand g
  WHERE a.views > 0
  ORDER BY a.views DESC, a.channel_bucket;
END;
$$;

COMMENT ON FUNCTION public.get_ga4_channel_breakdown(
  text, date, date, text, text[], text[], text[], text, text[], text[], integer[], text[], text, text[]
) IS
  'Channel breakdown. Unfiltered = GA4. Filtered VDP = GA4 channel mix scaled to Final KPI total.';

REVOKE ALL ON FUNCTION public.get_ga4_channel_breakdown(
  text, date, date, text, text[], text[], text[], text, text[], text[], integer[], text[], text, text[]
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_ga4_channel_breakdown(
  text, date, date, text, text[], text[], text[], text, text[], text[], integer[], text[], text, text[]
) TO anon, authenticated, service_role;


-- Type breakdown. Channel filter: sum GA4 page views joined to final inventory.
-- Prefers inv_custom_type (from type_ or dealer raw_data key). Falls back to inv_type.

DROP FUNCTION IF EXISTS public.get_type_breakdown(text, date, date);
DROP FUNCTION IF EXISTS public.get_type_breakdown(text, date, date, int);
DROP FUNCTION IF EXISTS public.get_type_breakdown(text, date, date, int, text[], text[], text[], text[], integer[], text);
DROP FUNCTION IF EXISTS public.get_type_breakdown(text, date, date, int, text[], text[], text[], text[], integer[], text, text[]);
DROP FUNCTION IF EXISTS public.get_type_breakdown(text, date, date, int, text[], text[], text[], text[], integer[], text, text[], text);
DROP FUNCTION IF EXISTS public.get_type_breakdown(text, date, date, int, text[], text[], text[], text[], integer[], text, text[], text, text[]);

CREATE OR REPLACE FUNCTION public.get_type_breakdown(
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
  p_ga4_property_id text DEFAULT NULL,
  p_mediums text[] DEFAULT NULL
)
RETURNS TABLE (
  type_bucket text,
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
      COALESCE(
        NULLIF(TRIM(f.inv_custom_type), ''),
        NULLIF(TRIM(f.inv_type), ''),
        'Other'
      ) AS type_bucket,
      COALESCE(p.views, 0)::bigint AS views
    FROM public.smart_ga4_page_data p
    INNER JOIN public.smart_final_data f
      ON f.client_id::text = p.client_id::text
     AND f.report_date = p.report_date
     AND f.page_path = p.page_path
     AND public.ga4_property_scope_matches(f.ga4_property_id, p.ga4_property_id)
    WHERE (COALESCE(array_length(p_channels, 1), 0) > 0 OR COALESCE(array_length(p_mediums, 1), 0) > 0)
      AND p.client_id::text = trim(p_client_id)
      AND public.ga4_property_scope_matches(p.ga4_property_id, p_ga4_property_id)
      AND p.report_date BETWEEN p_from AND p_to
      AND p.vdp_conditions IS TRUE
      AND (COALESCE(array_length(p_channels, 1), 0) = 0 OR public.vdp_channel_matches(p.channel, p_channels))
      AND (COALESCE(array_length(p_mediums, 1), 0) = 0 OR public.vdp_medium_matches(p.medium, p_mediums))
      AND (
        COALESCE(array_length(p_types, 1), 0) = 0
        OR EXISTS (
          SELECT 1
          FROM unnest(COALESCE(p_types, ARRAY[]::text[])) AS t
          WHERE lower(TRIM(t)) = lower(
            COALESCE(
              NULLIF(TRIM(f.inv_custom_type), ''),
              NULLIF(TRIM(f.inv_type), ''),
              'Other'
            )
          )
        )
      )
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
      COALESCE(
        NULLIF(TRIM(s.inv_custom_type), ''),
        NULLIF(TRIM(s.inv_type), ''),
        'Other'
      ) AS type_bucket,
      COALESCE(s.views, 0)::bigint AS views
    FROM public.smart_final_data s
    WHERE COALESCE(array_length(p_channels, 1), 0) = 0
      AND COALESCE(array_length(p_mediums, 1), 0) = 0
      AND s.client_id::text = trim(p_client_id)
      AND public.ga4_property_scope_matches(s.ga4_property_id, p_ga4_property_id)
      AND s.report_date BETWEEN p_from AND p_to
      AND (
        COALESCE(array_length(p_types, 1), 0) = 0
        OR EXISTS (
          SELECT 1
          FROM unnest(COALESCE(p_types, ARRAY[]::text[])) AS t
          WHERE lower(TRIM(t)) = lower(
            COALESCE(
              NULLIF(TRIM(s.inv_custom_type), ''),
              NULLIF(TRIM(s.inv_type), ''),
              'Other'
            )
          )
        )
      )
      AND (COALESCE(array_length(p_makes, 1), 0) = 0 OR s.inv_make = ANY(p_makes))
      AND (COALESCE(array_length(p_models, 1), 0) = 0 OR s.inv_model = ANY(p_models))
      AND (
        COALESCE(array_length(p_locations, 1), 0) = 0
        OR public.vdp_location_filter_match(trim(p_client_id), s.inv_location, p_locations)
      )
      AND (
        COALESCE(array_length(p_years, 1), 0) = 0
        OR (s.inv_year ~ '^\d{4}$' AND s.inv_year::int = ANY(p_years))
      )
      AND public.vdp_condition_matches(s.inv_condition, p_condition)
  ),
  agg AS (
    SELECT type_bucket, SUM(views)::bigint AS views
    FROM base
    GROUP BY type_bucket
  ),
  ranked AS (
    SELECT
      type_bucket,
      views,
      ROW_NUMBER() OVER (ORDER BY views DESC, type_bucket) AS rn
    FROM agg
  ),
  top_n AS (
    SELECT type_bucket, views, rn::int AS rank
    FROM ranked
    WHERE p_limit IS NULL OR rn <= p_limit
  ),
  other_bucket AS (
    SELECT
      'Other'::text AS type_bucket,
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
  kpi AS (
    SELECT public.get_vdp_views_total(
      trim(p_client_id), p_from, p_to,
      p_types, p_makes, p_models, p_locations, p_years, p_condition, p_channels, p_mediums
    ) AS target
  ),
  arrays AS (
    SELECT
      COALESCE(array_agg(c.type_bucket ORDER BY c.rank, c.type_bucket), ARRAY[]::text[]) AS buckets,
      COALESCE(array_agg(c.views ORDER BY c.rank, c.type_bucket), ARRAY[]::bigint[]) AS view_arr,
      COALESCE(array_agg(c.rank ORDER BY c.rank, c.type_bucket), ARRAY[]::int[]) AS ranks
    FROM combined c
  )
  SELECT
    s.bucket AS type_bucket,
    s.views,
    s.pct,
    s.rank
  FROM arrays a
  CROSS JOIN kpi k
  CROSS JOIN LATERAL public.vdp_scale_breakdown_to_kpi(a.buckets, a.view_arr, a.ranks, k.target) s
  ORDER BY s.rank;
$$;

REVOKE ALL ON FUNCTION public.get_type_breakdown(
  text, date, date, int, text[], text[], text[], text[], integer[], text, text[], text, text[]
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_type_breakdown(
  text, date, date, int, text[], text[], text[], text[], integer[], text, text[], text, text[]
) TO anon, authenticated, service_role;


-- Make breakdown. Channel filter: sum GA4 page views joined to final inventory.

DROP FUNCTION IF EXISTS public.get_make_breakdown(text, date, date);
DROP FUNCTION IF EXISTS public.get_make_breakdown(text, date, date, int);
DROP FUNCTION IF EXISTS public.get_make_breakdown(text, date, date, int, integer[]);
DROP FUNCTION IF EXISTS public.get_make_breakdown(text, date, date, int, text[], text[], text[], text[], integer[], text);
DROP FUNCTION IF EXISTS public.get_make_breakdown(text, date, date, int, text[], text[], text[], text[], integer[], text, text[]);
DROP FUNCTION IF EXISTS public.get_make_breakdown(text, date, date, int, text[], text[], text[], text[], integer[], text, text[], text);
DROP FUNCTION IF EXISTS public.get_make_breakdown(text, date, date, int, text[], text[], text[], text[], integer[], text, text[], text, text[]);

CREATE OR REPLACE FUNCTION public.get_make_breakdown(
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
  p_ga4_property_id text DEFAULT NULL,
  p_mediums text[] DEFAULT NULL
)
RETURNS TABLE (
  make_bucket text,
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
      COALESCE(NULLIF(TRIM(f.inv_make), ''), 'Other') AS make_bucket,
      COALESCE(p.views, 0)::bigint AS views
    FROM public.smart_ga4_page_data p
    INNER JOIN public.smart_final_data f
      ON f.client_id::text = p.client_id::text
     AND f.report_date = p.report_date
     AND f.page_path = p.page_path
     AND public.ga4_property_scope_matches(f.ga4_property_id, p.ga4_property_id)
    WHERE (COALESCE(array_length(p_channels, 1), 0) > 0 OR COALESCE(array_length(p_mediums, 1), 0) > 0)
      AND p.client_id::text = trim(p_client_id)
      AND public.ga4_property_scope_matches(p.ga4_property_id, p_ga4_property_id)
      AND p.report_date BETWEEN p_from AND p_to
      AND p.vdp_conditions IS TRUE
      AND (COALESCE(array_length(p_channels, 1), 0) = 0 OR public.vdp_channel_matches(p.channel, p_channels))
      AND (COALESCE(array_length(p_mediums, 1), 0) = 0 OR public.vdp_medium_matches(p.medium, p_mediums))
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
      COALESCE(NULLIF(TRIM(inv_make), ''), 'Other') AS make_bucket,
      COALESCE(views, 0)::bigint AS views
    FROM public.smart_final_data
    WHERE COALESCE(array_length(p_channels, 1), 0) = 0
      AND COALESCE(array_length(p_mediums, 1), 0) = 0
      AND client_id::text = trim(p_client_id)
      AND public.ga4_property_scope_matches(ga4_property_id, p_ga4_property_id)
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
    SELECT make_bucket, SUM(views)::bigint AS views
    FROM base
    GROUP BY make_bucket
  ),
  ranked AS (
    SELECT
      make_bucket,
      views,
      ROW_NUMBER() OVER (ORDER BY views DESC, make_bucket) AS rn
    FROM agg
  ),
  top_n AS (
    SELECT make_bucket, views, rn::int AS rank
    FROM ranked
    WHERE p_limit IS NULL OR rn <= p_limit
  ),
  other_bucket AS (
    SELECT
      'Other'::text AS make_bucket,
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
  kpi AS (
    SELECT public.get_vdp_views_total(
      trim(p_client_id), p_from, p_to,
      p_types, p_makes, p_models, p_locations, p_years, p_condition, p_channels, p_mediums
    ) AS target
  ),
  arrays AS (
    SELECT
      COALESCE(array_agg(c.make_bucket ORDER BY c.rank, c.make_bucket), ARRAY[]::text[]) AS buckets,
      COALESCE(array_agg(c.views ORDER BY c.rank, c.make_bucket), ARRAY[]::bigint[]) AS view_arr,
      COALESCE(array_agg(c.rank ORDER BY c.rank, c.make_bucket), ARRAY[]::int[]) AS ranks
    FROM combined c
  )
  SELECT
    s.bucket AS make_bucket,
    s.views,
    s.pct,
    s.rank
  FROM arrays a
  CROSS JOIN kpi k
  CROSS JOIN LATERAL public.vdp_scale_breakdown_to_kpi(a.buckets, a.view_arr, a.ranks, k.target) s
  ORDER BY s.rank;
$$;

REVOKE ALL ON FUNCTION public.get_make_breakdown(
  text, date, date, int, text[], text[], text[], text[], integer[], text, text[], text, text[]
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_make_breakdown(
  text, date, date, int, text[], text[], text[], text[], integer[], text, text[], text, text[]
) TO anon, authenticated, service_role;


-- Model breakdown. Channel filter: sum GA4 page views joined to final inventory.

DROP FUNCTION IF EXISTS public.get_model_breakdown(text, date, date, int);
DROP FUNCTION IF EXISTS public.get_model_breakdown(text, date, date, int, integer[]);
DROP FUNCTION IF EXISTS public.get_model_breakdown(text, date, date, int, text[], text[], text[], text[], integer[], text);
DROP FUNCTION IF EXISTS public.get_model_breakdown(text, date, date, int, text[], text[], text[], text[], integer[], text, text[]);
DROP FUNCTION IF EXISTS public.get_model_breakdown(text, date, date, int, text[], text[], text[], text[], integer[], text, text[], text);
DROP FUNCTION IF EXISTS public.get_model_breakdown(text, date, date, int, text[], text[], text[], text[], integer[], text, text[], text, text[]);

CREATE OR REPLACE FUNCTION public.get_model_breakdown(
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
  p_ga4_property_id text DEFAULT NULL,
  p_mediums text[] DEFAULT NULL
)
RETURNS TABLE (
  model_bucket text,
  make_bucket text,
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
      COALESCE(NULLIF(TRIM(f.inv_model), ''), 'Other') AS model_bucket,
      COALESCE(NULLIF(TRIM(f.inv_make), ''), '') AS make_bucket,
      COALESCE(p.views, 0)::bigint AS views
    FROM public.smart_ga4_page_data p
    INNER JOIN public.smart_final_data f
      ON f.client_id::text = p.client_id::text
     AND f.report_date = p.report_date
     AND f.page_path = p.page_path
     AND public.ga4_property_scope_matches(f.ga4_property_id, p.ga4_property_id)
    WHERE (COALESCE(array_length(p_channels, 1), 0) > 0 OR COALESCE(array_length(p_mediums, 1), 0) > 0)
      AND p.client_id::text = trim(p_client_id)
      AND public.ga4_property_scope_matches(p.ga4_property_id, p_ga4_property_id)
      AND p.report_date BETWEEN p_from AND p_to
      AND p.vdp_conditions IS TRUE
      AND (COALESCE(array_length(p_channels, 1), 0) = 0 OR public.vdp_channel_matches(p.channel, p_channels))
      AND (COALESCE(array_length(p_mediums, 1), 0) = 0 OR public.vdp_medium_matches(p.medium, p_mediums))
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
      COALESCE(NULLIF(TRIM(inv_model), ''), 'Other') AS model_bucket,
      COALESCE(NULLIF(TRIM(inv_make), ''), '') AS make_bucket,
      COALESCE(views, 0)::bigint AS views
    FROM public.smart_final_data
    WHERE COALESCE(array_length(p_channels, 1), 0) = 0
      AND COALESCE(array_length(p_mediums, 1), 0) = 0
      AND client_id::text = trim(p_client_id)
      AND public.ga4_property_scope_matches(ga4_property_id, p_ga4_property_id)
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
    SELECT model_bucket, make_bucket, SUM(views)::bigint AS views
    FROM base
    GROUP BY model_bucket, make_bucket
  ),
  ranked AS (
    SELECT
      model_bucket,
      make_bucket,
      views,
      ROW_NUMBER() OVER (ORDER BY views DESC, model_bucket) AS rn
    FROM agg
  ),
  top_n AS (
    SELECT model_bucket, make_bucket, views, rn::int AS rank
    FROM ranked
    WHERE p_limit IS NULL OR rn <= p_limit
  ),
  other_bucket AS (
    SELECT
      'Other'::text AS model_bucket,
      ''::text AS make_bucket,
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
  kpi AS (
    SELECT public.get_vdp_views_total(
      trim(p_client_id), p_from, p_to,
      p_types, p_makes, p_models, p_locations, p_years, p_condition, p_channels, p_mediums
    ) AS target
  ),
  arrays AS (
    SELECT
      COALESCE(array_agg(c.model_bucket ORDER BY c.rank, c.model_bucket), ARRAY[]::text[]) AS buckets,
      COALESCE(array_agg(c.views ORDER BY c.rank, c.model_bucket), ARRAY[]::bigint[]) AS view_arr,
      COALESCE(array_agg(c.rank ORDER BY c.rank, c.model_bucket), ARRAY[]::int[]) AS ranks
    FROM combined c
  )
  SELECT
    s.bucket AS model_bucket,
    COALESCE(
      (
        SELECT c.make_bucket
        FROM combined c
        WHERE c.model_bucket = s.bucket AND c.rank = s.rank
        LIMIT 1
      ),
      ''
    ) AS make_bucket,
    s.views,
    s.pct,
    s.rank
  FROM arrays a
  CROSS JOIN kpi k
  CROSS JOIN LATERAL public.vdp_scale_breakdown_to_kpi(a.buckets, a.view_arr, a.ranks, k.target) s
  ORDER BY s.rank;
$$;

REVOKE ALL ON FUNCTION public.get_model_breakdown(
  text, date, date, int, text[], text[], text[], text[], integer[], text, text[], text, text[]
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_model_breakdown(
  text, date, date, int, text[], text[], text[], text[], integer[], text, text[], text, text[]
) TO anon, authenticated, service_role;


-- Year breakdown. Channel filter: sum GA4 page views joined to final inventory.

DROP FUNCTION IF EXISTS public.get_year_breakdown(text, date, date, int);
DROP FUNCTION IF EXISTS public.get_year_breakdown(text, date, date, int, integer[]);
DROP FUNCTION IF EXISTS public.get_year_breakdown(text, date, date, int, text[], text[], text[], text[], integer[], text);
DROP FUNCTION IF EXISTS public.get_year_breakdown(text, date, date, int, text[], text[], text[], text[], integer[], text, text[]);
DROP FUNCTION IF EXISTS public.get_year_breakdown(text, date, date, int, text[], text[], text[], text[], integer[], text, text[], text);
DROP FUNCTION IF EXISTS public.get_year_breakdown(text, date, date, int, text[], text[], text[], text[], integer[], text, text[], text, text[]);

CREATE OR REPLACE FUNCTION public.get_year_breakdown(
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
  p_ga4_property_id text DEFAULT NULL,
  p_mediums text[] DEFAULT NULL
)
RETURNS TABLE (
  year_bucket text,
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
      COALESCE(NULLIF(TRIM(f.inv_year), ''), 'Other') AS year_bucket,
      COALESCE(p.views, 0)::bigint AS views
    FROM public.smart_ga4_page_data p
    INNER JOIN public.smart_final_data f
      ON f.client_id::text = p.client_id::text
     AND f.report_date = p.report_date
     AND f.page_path = p.page_path
     AND public.ga4_property_scope_matches(f.ga4_property_id, p.ga4_property_id)
    WHERE (COALESCE(array_length(p_channels, 1), 0) > 0 OR COALESCE(array_length(p_mediums, 1), 0) > 0)
      AND p.client_id::text = trim(p_client_id)
      AND public.ga4_property_scope_matches(p.ga4_property_id, p_ga4_property_id)
      AND p.report_date BETWEEN p_from AND p_to
      AND p.vdp_conditions IS TRUE
      AND (COALESCE(array_length(p_channels, 1), 0) = 0 OR public.vdp_channel_matches(p.channel, p_channels))
      AND (COALESCE(array_length(p_mediums, 1), 0) = 0 OR public.vdp_medium_matches(p.medium, p_mediums))
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
      COALESCE(NULLIF(TRIM(inv_year), ''), 'Other') AS year_bucket,
      COALESCE(views, 0)::bigint AS views
    FROM public.smart_final_data
    WHERE COALESCE(array_length(p_channels, 1), 0) = 0
      AND COALESCE(array_length(p_mediums, 1), 0) = 0
      AND client_id::text = trim(p_client_id)
      AND public.ga4_property_scope_matches(ga4_property_id, p_ga4_property_id)
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
    SELECT year_bucket, SUM(views)::bigint AS views
    FROM base
    GROUP BY year_bucket
  ),
  ranked AS (
    SELECT
      year_bucket,
      views,
      ROW_NUMBER() OVER (ORDER BY views DESC, year_bucket DESC) AS rn
    FROM agg
  ),
  top_n AS (
    SELECT year_bucket, views, rn::int AS rank
    FROM ranked
    WHERE p_limit IS NULL OR rn <= p_limit
  ),
  other_bucket AS (
    SELECT
      'Other'::text AS year_bucket,
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
  kpi AS (
    SELECT public.get_vdp_views_total(
      trim(p_client_id), p_from, p_to,
      p_types, p_makes, p_models, p_locations, p_years, p_condition, p_channels, p_mediums
    ) AS target
  ),
  arrays AS (
    SELECT
      COALESCE(array_agg(c.year_bucket ORDER BY c.rank, c.year_bucket), ARRAY[]::text[]) AS buckets,
      COALESCE(array_agg(c.views ORDER BY c.rank, c.year_bucket), ARRAY[]::bigint[]) AS view_arr,
      COALESCE(array_agg(c.rank ORDER BY c.rank, c.year_bucket), ARRAY[]::int[]) AS ranks
    FROM combined c
  )
  SELECT
    s.bucket AS year_bucket,
    s.views,
    s.pct,
    s.rank
  FROM arrays a
  CROSS JOIN kpi k
  CROSS JOIN LATERAL public.vdp_scale_breakdown_to_kpi(a.buckets, a.view_arr, a.ranks, k.target) s
  ORDER BY s.rank;
$$;

REVOKE ALL ON FUNCTION public.get_year_breakdown(
  text, date, date, int, text[], text[], text[], text[], integer[], text, text[], text, text[]
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_year_breakdown(
  text, date, date, int, text[], text[], text[], text[], integer[], text, text[], text, text[]
) TO anon, authenticated, service_role;


-- Condition breakdown. Channel filter: sum GA4 page views joined to final inventory.

DROP FUNCTION IF EXISTS public.get_condition_breakdown(text, date, date, int);
DROP FUNCTION IF EXISTS public.get_condition_breakdown(text, date, date, int, integer[]);
DROP FUNCTION IF EXISTS public.get_condition_breakdown(text, date, date, int, text[], text[], text[], text[], integer[], text);
DROP FUNCTION IF EXISTS public.get_condition_breakdown(text, date, date, int, text[], text[], text[], text[], integer[], text, text[]);
DROP FUNCTION IF EXISTS public.get_condition_breakdown(text, date, date, int, text[], text[], text[], text[], integer[], text, text[], text);
DROP FUNCTION IF EXISTS public.get_condition_breakdown(text, date, date, int, text[], text[], text[], text[], integer[], text, text[], text, text[]);

CREATE OR REPLACE FUNCTION public.get_condition_breakdown(
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
  p_ga4_property_id text DEFAULT NULL,
  p_mediums text[] DEFAULT NULL
)
RETURNS TABLE (
  condition_bucket text,
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
      COALESCE(NULLIF(TRIM(f.inv_condition), ''), 'Other') AS condition_bucket,
      COALESCE(p.views, 0)::bigint AS views
    FROM public.smart_ga4_page_data p
    INNER JOIN public.smart_final_data f
      ON f.client_id::text = p.client_id::text
     AND f.report_date = p.report_date
     AND f.page_path = p.page_path
     AND public.ga4_property_scope_matches(f.ga4_property_id, p.ga4_property_id)
    WHERE (COALESCE(array_length(p_channels, 1), 0) > 0 OR COALESCE(array_length(p_mediums, 1), 0) > 0)
      AND p.client_id::text = trim(p_client_id)
      AND public.ga4_property_scope_matches(p.ga4_property_id, p_ga4_property_id)
      AND p.report_date BETWEEN p_from AND p_to
      AND p.vdp_conditions IS TRUE
      AND (COALESCE(array_length(p_channels, 1), 0) = 0 OR public.vdp_channel_matches(p.channel, p_channels))
      AND (COALESCE(array_length(p_mediums, 1), 0) = 0 OR public.vdp_medium_matches(p.medium, p_mediums))
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
      COALESCE(NULLIF(TRIM(inv_condition), ''), 'Other') AS condition_bucket,
      COALESCE(views, 0)::bigint AS views
    FROM public.smart_final_data
    WHERE COALESCE(array_length(p_channels, 1), 0) = 0
      AND COALESCE(array_length(p_mediums, 1), 0) = 0
      AND client_id::text = trim(p_client_id)
      AND public.ga4_property_scope_matches(ga4_property_id, p_ga4_property_id)
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
    SELECT condition_bucket, SUM(views)::bigint AS views
    FROM base
    GROUP BY condition_bucket
  ),
  ranked AS (
    SELECT
      condition_bucket,
      views,
      ROW_NUMBER() OVER (ORDER BY views DESC, condition_bucket) AS rn
    FROM agg
  ),
  top_n AS (
    SELECT condition_bucket, views, rn::int AS rank
    FROM ranked
    WHERE p_limit IS NULL OR rn <= p_limit
  ),
  other_bucket AS (
    SELECT
      'Other'::text AS condition_bucket,
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
  kpi AS (
    SELECT public.get_vdp_views_total(
      trim(p_client_id), p_from, p_to,
      p_types, p_makes, p_models, p_locations, p_years, p_condition, p_channels, p_mediums
    ) AS target
  ),
  arrays AS (
    SELECT
      COALESCE(array_agg(c.condition_bucket ORDER BY c.rank, c.condition_bucket), ARRAY[]::text[]) AS buckets,
      COALESCE(array_agg(c.views ORDER BY c.rank, c.condition_bucket), ARRAY[]::bigint[]) AS view_arr,
      COALESCE(array_agg(c.rank ORDER BY c.rank, c.condition_bucket), ARRAY[]::int[]) AS ranks
    FROM combined c
  )
  SELECT
    s.bucket AS condition_bucket,
    s.views,
    s.pct,
    s.rank
  FROM arrays a
  CROSS JOIN kpi k
  CROSS JOIN LATERAL public.vdp_scale_breakdown_to_kpi(a.buckets, a.view_arr, a.ranks, k.target) s
  ORDER BY s.rank;
$$;

REVOKE ALL ON FUNCTION public.get_condition_breakdown(
  text, date, date, int, text[], text[], text[], text[], integer[], text, text[], text, text[]
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_condition_breakdown(
  text, date, date, int, text[], text[], text[], text[], integer[], text, text[], text, text[]
) TO anon, authenticated, service_role;


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
DROP FUNCTION IF EXISTS public.get_location_breakdown(
  text, date, date, int, text[], text[], text[], text[], integer[], text, text[], text, text[]
);

DROP FUNCTION IF EXISTS public.get_location_breakdown(text, date, date, int, text[], text[], text[], text[], integer[], text, text[], text);
DROP FUNCTION IF EXISTS public.get_location_breakdown(text, date, date, int, text[], text[], text[], text[], integer[], text, text[], text, text[]);

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
  p_channels text[] DEFAULT NULL,
  p_ga4_property_id text DEFAULT NULL,
  p_mediums text[] DEFAULT NULL
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
      COALESCE(NULLIF(TRIM(f.inv_location), ''), 'Other') AS location_bucket,
      COALESCE(p.views, 0)::bigint AS views
    FROM public.smart_ga4_page_data p
    INNER JOIN public.smart_final_data f
      ON f.client_id::text = p.client_id::text
     AND f.report_date = p.report_date
     AND f.page_path = p.page_path
     AND public.ga4_property_scope_matches(f.ga4_property_id, p.ga4_property_id)
    WHERE (COALESCE(array_length(p_channels, 1), 0) > 0 OR COALESCE(array_length(p_mediums, 1), 0) > 0)
      AND p.client_id::text = trim(p_client_id)
      AND public.ga4_property_scope_matches(p.ga4_property_id, p_ga4_property_id)
      AND p.report_date BETWEEN p_from AND p_to
      AND p.vdp_conditions IS TRUE
      AND (COALESCE(array_length(p_channels, 1), 0) = 0 OR public.vdp_channel_matches(p.channel, p_channels))
      AND (COALESCE(array_length(p_mediums, 1), 0) = 0 OR public.vdp_medium_matches(p.medium, p_mediums))
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
      COALESCE(NULLIF(TRIM(inv_location), ''), 'Other') AS location_bucket,
      COALESCE(views, 0)::bigint AS views
    FROM public.smart_final_data
    WHERE COALESCE(array_length(p_channels, 1), 0) = 0
      AND COALESCE(array_length(p_mediums, 1), 0) = 0
      AND client_id::text = trim(p_client_id)
      AND public.ga4_property_scope_matches(ga4_property_id, p_ga4_property_id)
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
  kpi AS (
    SELECT public.get_vdp_views_total(
      trim(p_client_id), p_from, p_to,
      p_types, p_makes, p_models, p_locations, p_years, p_condition, p_channels, p_mediums
    ) AS target
  ),
  arrays AS (
    SELECT
      COALESCE(array_agg(c.location_bucket ORDER BY c.rank, c.location_bucket), ARRAY[]::text[]) AS buckets,
      COALESCE(array_agg(c.views ORDER BY c.rank, c.location_bucket), ARRAY[]::bigint[]) AS view_arr,
      COALESCE(array_agg(c.rank ORDER BY c.rank, c.location_bucket), ARRAY[]::int[]) AS ranks
    FROM combined c
  )
  SELECT
    s.bucket AS location_bucket,
    s.views,
    s.pct,
    s.rank
  FROM arrays a
  CROSS JOIN kpi k
  CROSS JOIN LATERAL public.vdp_scale_breakdown_to_kpi(a.buckets, a.view_arr, a.ranks, k.target) s
  ORDER BY s.rank;
$$;

REVOKE ALL ON FUNCTION public.get_location_breakdown(
  text, date, date, int, text[], text[], text[], text[], integer[], text, text[], text, text[]
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_location_breakdown(
  text, date, date, int, text[], text[], text[], text[], integer[], text, text[], text, text[]
) TO anon, authenticated, service_role;
