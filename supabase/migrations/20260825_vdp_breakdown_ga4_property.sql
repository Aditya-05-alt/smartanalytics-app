-- VDP breakdown RPCs: ga4_property_id scope

-- get_make_breakdown
-- Make breakdown. Channel filter: sum GA4 page views joined to final inventory.

DROP FUNCTION IF EXISTS public.get_make_breakdown(text, date, date);
DROP FUNCTION IF EXISTS public.get_make_breakdown(text, date, date, int);
DROP FUNCTION IF EXISTS public.get_make_breakdown(text, date, date, int, integer[]);
DROP FUNCTION IF EXISTS public.get_make_breakdown(text, date, date, int, text[], text[], text[], text[], integer[], text);
DROP FUNCTION IF EXISTS public.get_make_breakdown(text, date, date, int, text[], text[], text[], text[], integer[], text, text[]);
DROP FUNCTION IF EXISTS public.get_make_breakdown(text, date, date, int, text[], text[], text[], text[], integer[], text, text[], text);

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
  p_ga4_property_id text DEFAULT NULL
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
      COALESCE(NULLIF(TRIM(f.inv_make), ''), 'Unknown') AS make_bucket,
      COALESCE(p.views, 0)::bigint AS views
    FROM public.smart_ga4_page_data p
    INNER JOIN public.smart_final_data f
      ON f.client_id::text = p.client_id::text
     AND f.report_date = p.report_date
     AND f.page_path = p.page_path
     AND public.ga4_property_scope_matches(f.ga4_property_id, p.ga4_property_id)
    WHERE COALESCE(array_length(p_channels, 1), 0) > 0
      AND p.client_id::text = trim(p_client_id)
      AND public.ga4_property_scope_matches(p.ga4_property_id, p_ga4_property_id)
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
      COALESCE(NULLIF(TRIM(inv_make), ''), 'Unknown') AS make_bucket,
      COALESCE(views, 0)::bigint AS views
    FROM public.smart_final_data
    WHERE COALESCE(array_length(p_channels, 1), 0) = 0
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
  grand AS (
    SELECT NULLIF(SUM(views), 0)::numeric AS total
    FROM combined
  )
  SELECT
    c.make_bucket,
    c.views,
    ROUND(100.0 * c.views / g.total, 2) AS pct,
    c.rank
  FROM combined c
  CROSS JOIN grand g
  ORDER BY c.rank;
$$;

REVOKE ALL ON FUNCTION public.get_make_breakdown(
  text, date, date, int, text[], text[], text[], text[], integer[], text, text[], text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_make_breakdown(
  text, date, date, int, text[], text[], text[], text[], integer[], text, text[], text
) TO anon, authenticated, service_role;

-- get_type_breakdown
-- Type breakdown. Channel filter: sum GA4 page views joined to final inventory.
-- Prefers inv_custom_type (from type_ or dealer raw_data key). Falls back to inv_type.

DROP FUNCTION IF EXISTS public.get_type_breakdown(text, date, date);
DROP FUNCTION IF EXISTS public.get_type_breakdown(text, date, date, int);
DROP FUNCTION IF EXISTS public.get_type_breakdown(text, date, date, int, text[], text[], text[], text[], integer[], text);
DROP FUNCTION IF EXISTS public.get_type_breakdown(text, date, date, int, text[], text[], text[], text[], integer[], text, text[]);
DROP FUNCTION IF EXISTS public.get_type_breakdown(text, date, date, int, text[], text[], text[], text[], integer[], text, text[], text);

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
  p_ga4_property_id text DEFAULT NULL
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
        'Unknown'
      ) AS type_bucket,
      COALESCE(p.views, 0)::bigint AS views
    FROM public.smart_ga4_page_data p
    INNER JOIN public.smart_final_data f
      ON f.client_id::text = p.client_id::text
     AND f.report_date = p.report_date
     AND f.page_path = p.page_path
     AND public.ga4_property_scope_matches(f.ga4_property_id, p.ga4_property_id)
    WHERE COALESCE(array_length(p_channels, 1), 0) > 0
      AND p.client_id::text = trim(p_client_id)
      AND public.ga4_property_scope_matches(p.ga4_property_id, p_ga4_property_id)
      AND p.report_date BETWEEN p_from AND p_to
      AND p.vdp_conditions IS TRUE
      AND public.vdp_channel_matches(p.channel, p_channels)
      AND (
        COALESCE(array_length(p_types, 1), 0) = 0
        OR EXISTS (
          SELECT 1
          FROM unnest(COALESCE(p_types, ARRAY[]::text[])) AS t
          WHERE lower(TRIM(t)) = lower(
            COALESCE(
              NULLIF(TRIM(f.inv_custom_type), ''),
              NULLIF(TRIM(f.inv_type), ''),
              'Unknown'
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
        'Unknown'
      ) AS type_bucket,
      COALESCE(s.views, 0)::bigint AS views
    FROM public.smart_final_data s
    WHERE COALESCE(array_length(p_channels, 1), 0) = 0
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
              'Unknown'
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
  grand AS (
    SELECT NULLIF(SUM(views), 0)::numeric AS total
    FROM combined
  )
  SELECT
    c.type_bucket,
    c.views,
    ROUND(100.0 * c.views / g.total, 2) AS pct,
    c.rank
  FROM combined c
  CROSS JOIN grand g
  ORDER BY c.rank;
$$;

REVOKE ALL ON FUNCTION public.get_type_breakdown(
  text, date, date, int, text[], text[], text[], text[], integer[], text, text[], text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_type_breakdown(
  text, date, date, int, text[], text[], text[], text[], integer[], text, text[], text
) TO anon, authenticated, service_role;

-- get_model_breakdown
-- Model breakdown. Channel filter: sum GA4 page views joined to final inventory.

DROP FUNCTION IF EXISTS public.get_model_breakdown(text, date, date, int);
DROP FUNCTION IF EXISTS public.get_model_breakdown(text, date, date, int, integer[]);
DROP FUNCTION IF EXISTS public.get_model_breakdown(text, date, date, int, text[], text[], text[], text[], integer[], text);
DROP FUNCTION IF EXISTS public.get_model_breakdown(text, date, date, int, text[], text[], text[], text[], integer[], text, text[]);
DROP FUNCTION IF EXISTS public.get_model_breakdown(text, date, date, int, text[], text[], text[], text[], integer[], text, text[], text);

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
  p_ga4_property_id text DEFAULT NULL
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
      COALESCE(NULLIF(TRIM(f.inv_model), ''), 'Unknown') AS model_bucket,
      COALESCE(NULLIF(TRIM(f.inv_make), ''), '') AS make_bucket,
      COALESCE(p.views, 0)::bigint AS views
    FROM public.smart_ga4_page_data p
    INNER JOIN public.smart_final_data f
      ON f.client_id::text = p.client_id::text
     AND f.report_date = p.report_date
     AND f.page_path = p.page_path
     AND public.ga4_property_scope_matches(f.ga4_property_id, p.ga4_property_id)
    WHERE COALESCE(array_length(p_channels, 1), 0) > 0
      AND p.client_id::text = trim(p_client_id)
      AND public.ga4_property_scope_matches(p.ga4_property_id, p_ga4_property_id)
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
      COALESCE(NULLIF(TRIM(inv_model), ''), 'Unknown') AS model_bucket,
      COALESCE(NULLIF(TRIM(inv_make), ''), '') AS make_bucket,
      COALESCE(views, 0)::bigint AS views
    FROM public.smart_final_data
    WHERE COALESCE(array_length(p_channels, 1), 0) = 0
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
  grand AS (
    SELECT NULLIF(SUM(views), 0)::numeric AS total
    FROM combined
  )
  SELECT
    c.model_bucket,
    c.make_bucket,
    c.views,
    ROUND(100.0 * c.views / g.total, 2) AS pct,
    c.rank
  FROM combined c
  CROSS JOIN grand g
  ORDER BY c.rank;
$$;

REVOKE ALL ON FUNCTION public.get_model_breakdown(
  text, date, date, int, text[], text[], text[], text[], integer[], text, text[], text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_model_breakdown(
  text, date, date, int, text[], text[], text[], text[], integer[], text, text[], text
) TO anon, authenticated, service_role;

-- get_year_breakdown
-- Year breakdown. Channel filter: sum GA4 page views joined to final inventory.

DROP FUNCTION IF EXISTS public.get_year_breakdown(text, date, date, int);
DROP FUNCTION IF EXISTS public.get_year_breakdown(text, date, date, int, integer[]);
DROP FUNCTION IF EXISTS public.get_year_breakdown(text, date, date, int, text[], text[], text[], text[], integer[], text);
DROP FUNCTION IF EXISTS public.get_year_breakdown(text, date, date, int, text[], text[], text[], text[], integer[], text, text[]);
DROP FUNCTION IF EXISTS public.get_year_breakdown(text, date, date, int, text[], text[], text[], text[], integer[], text, text[], text);

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
  p_ga4_property_id text DEFAULT NULL
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
      COALESCE(NULLIF(TRIM(f.inv_year), ''), 'Unknown') AS year_bucket,
      COALESCE(p.views, 0)::bigint AS views
    FROM public.smart_ga4_page_data p
    INNER JOIN public.smart_final_data f
      ON f.client_id::text = p.client_id::text
     AND f.report_date = p.report_date
     AND f.page_path = p.page_path
     AND public.ga4_property_scope_matches(f.ga4_property_id, p.ga4_property_id)
    WHERE COALESCE(array_length(p_channels, 1), 0) > 0
      AND p.client_id::text = trim(p_client_id)
      AND public.ga4_property_scope_matches(p.ga4_property_id, p_ga4_property_id)
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
      COALESCE(NULLIF(TRIM(inv_year), ''), 'Unknown') AS year_bucket,
      COALESCE(views, 0)::bigint AS views
    FROM public.smart_final_data
    WHERE COALESCE(array_length(p_channels, 1), 0) = 0
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
  grand AS (
    SELECT NULLIF(SUM(views), 0)::numeric AS total
    FROM combined
  )
  SELECT
    c.year_bucket,
    c.views,
    ROUND(100.0 * c.views / g.total, 2) AS pct,
    c.rank
  FROM combined c
  CROSS JOIN grand g
  ORDER BY c.rank;
$$;

REVOKE ALL ON FUNCTION public.get_year_breakdown(
  text, date, date, int, text[], text[], text[], text[], integer[], text, text[], text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_year_breakdown(
  text, date, date, int, text[], text[], text[], text[], integer[], text, text[], text
) TO anon, authenticated, service_role;

-- get_condition_breakdown
-- Condition breakdown. Channel filter: sum GA4 page views joined to final inventory.

DROP FUNCTION IF EXISTS public.get_condition_breakdown(text, date, date, int);
DROP FUNCTION IF EXISTS public.get_condition_breakdown(text, date, date, int, integer[]);
DROP FUNCTION IF EXISTS public.get_condition_breakdown(text, date, date, int, text[], text[], text[], text[], integer[], text);
DROP FUNCTION IF EXISTS public.get_condition_breakdown(text, date, date, int, text[], text[], text[], text[], integer[], text, text[]);
DROP FUNCTION IF EXISTS public.get_condition_breakdown(text, date, date, int, text[], text[], text[], text[], integer[], text, text[], text);

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
  p_ga4_property_id text DEFAULT NULL
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
      COALESCE(NULLIF(TRIM(f.inv_condition), ''), 'Unknown') AS condition_bucket,
      COALESCE(p.views, 0)::bigint AS views
    FROM public.smart_ga4_page_data p
    INNER JOIN public.smart_final_data f
      ON f.client_id::text = p.client_id::text
     AND f.report_date = p.report_date
     AND f.page_path = p.page_path
     AND public.ga4_property_scope_matches(f.ga4_property_id, p.ga4_property_id)
    WHERE COALESCE(array_length(p_channels, 1), 0) > 0
      AND p.client_id::text = trim(p_client_id)
      AND public.ga4_property_scope_matches(p.ga4_property_id, p_ga4_property_id)
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
      COALESCE(NULLIF(TRIM(inv_condition), ''), 'Unknown') AS condition_bucket,
      COALESCE(views, 0)::bigint AS views
    FROM public.smart_final_data
    WHERE COALESCE(array_length(p_channels, 1), 0) = 0
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
  grand AS (
    SELECT NULLIF(SUM(views), 0)::numeric AS total
    FROM combined
  )
  SELECT
    c.condition_bucket,
    c.views,
    ROUND(100.0 * c.views / g.total, 2) AS pct,
    c.rank
  FROM combined c
  CROSS JOIN grand g
  ORDER BY c.rank;
$$;

REVOKE ALL ON FUNCTION public.get_condition_breakdown(
  text, date, date, int, text[], text[], text[], text[], integer[], text, text[], text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_condition_breakdown(
  text, date, date, int, text[], text[], text[], text[], integer[], text, text[], text
) TO anon, authenticated, service_role;

-- get_location_breakdown
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
  text, date, date, int, text[], text[], text[], text[], integer[], text, text[], text
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
  p_channels text[] DEFAULT NULL,
  p_ga4_property_id text DEFAULT NULL
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
     AND public.ga4_property_scope_matches(f.ga4_property_id, p.ga4_property_id)
    WHERE COALESCE(array_length(p_channels, 1), 0) > 0
      AND p.client_id::text = trim(p_client_id)
      AND public.ga4_property_scope_matches(p.ga4_property_id, p_ga4_property_id)
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
  text, date, date, int, text[], text[], text[], text[], integer[], text, text[], text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_location_breakdown(
  text, date, date, int, text[], text[], text[], text[], integer[], text, text[], text
) TO anon, authenticated, service_role;

-- get_dealer_location_breakdown
-- Thin wrapper over get_location_breakdown.
-- Old logic stays unchanged. If dealer has exactly ONE row in
-- smart_dealer_locations, rename Unknown → that hardcoded location name.
-- Deploy in Supabase SQL editor (replaces the heavy matching version).

DROP FUNCTION IF EXISTS public.get_dealer_location_breakdown(
  text, date, date, int, text[], text[], text[], text[], integer[], text
);
DROP FUNCTION IF EXISTS public.get_dealer_location_breakdown(
  text, date, date, int, text[], text[], text[], text[], integer[], text, text
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

  -- 0 or 2+ configured names → exact old breakdown (no remap).
  IF COALESCE(v_loc_count, 0) <> 1 THEN
    RETURN QUERY
    SELECT * FROM public.get_location_breakdown(
      p_client_id, p_from, p_to, p_limit,
      p_types, p_makes, p_models, p_locations, p_years, p_condition,
      NULL, p_ga4_property_id
    );
    RETURN;
  END IF;

  -- Exactly one hardcoded name: run old logic, then Unknown → that name.
  RETURN QUERY
  WITH base AS (
    SELECT
      CASE
        WHEN LOWER(TRIM(lb.location_bucket)) IN ('unknown', '')
          THEN v_single_location
        ELSE lb.location_bucket
      END AS location_bucket,
      lb.views
    FROM public.get_location_breakdown(
      p_client_id, p_from, p_to, p_limit,
      p_types, p_makes, p_models, p_locations, p_years, p_condition,
      NULL, p_ga4_property_id
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
  text, date, date, int, text[], text[], text[], text[], integer[], text, text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_dealer_location_breakdown(
  text, date, date, int, text[], text[], text[], text[], integer[], text, text
) TO anon, authenticated, service_role;

-- get_vdp_page_title_by_channel
-- VDP tab: top page titles × channel columns.
-- Display title preference:
--   1) real GA4/final page_title (not blank, not a URL/path)
--   2) inventory-built title (Condition Year Make Model … | Location | #Stock)
--   3) humanized last path segment (never raw /full/url/path)
-- Paid Search = paid_search + cross_network + display.
-- Facebook = paid/organic social + facebook sources.
-- Deploy in Supabase SQL editor.

DROP FUNCTION IF EXISTS public.get_vdp_page_title_by_channel(
  text, date, date, int, text[], text[], text[], text[], integer[], text
);
DROP FUNCTION IF EXISTS public.get_vdp_page_title_by_channel(
  text, date, date, int, text[], text[], text[], text[], integer[], text, text[]
);
DROP FUNCTION IF EXISTS public.get_vdp_page_title_by_channel(
  text, date, date, int, text[], text[], text[], text[], integer[], text, text[], text
);

CREATE OR REPLACE FUNCTION public.get_vdp_page_title_by_channel(
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
  page_title text,
  page_path text,
  page_url text,
  organic_search bigint,
  direct bigint,
  paid_search bigint,
  facebook bigint,
  referral bigint,
  total_views bigint,
  rank int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH final_paths AS (
    SELECT
      s.client_id,
      s.report_date,
      s.page_path,
      NULLIF(TRIM(s.page_title), '') AS page_title,
      CASE
        WHEN NULLIF(TRIM(s.inv_url), '') ~* '^https?://' THEN TRIM(s.inv_url)
        WHEN NULLIF(TRIM(s.page_location), '') ~* '^https?://'
             AND TRIM(s.page_location) !~* 'hootinteractive\.net' THEN TRIM(s.page_location)
        ELSE NULL
      END AS page_url,
      NULLIF(TRIM(s.inv_condition), '') AS inv_condition,
      NULLIF(TRIM(s.inv_year), '') AS inv_year,
      NULLIF(TRIM(s.inv_make), '') AS inv_make,
      NULLIF(TRIM(s.inv_model), '') AS inv_model,
      NULLIF(TRIM(s.inv_trim), '') AS inv_trim,
      NULLIF(TRIM(s.inv_type), '') AS inv_type,
      NULLIF(TRIM(s.inv_location), '') AS inv_location,
      NULLIF(TRIM(s.inv_stock_number), '') AS inv_stock_number,
      COALESCE(
        NULLIF(TRIM(s.hoot_customer_name), ''),
        NULLIF(TRIM(s.account_name), '')
      ) AS dealer_name
    FROM public.smart_final_data s
    WHERE s.client_id::text = trim(p_client_id)
      AND public.ga4_property_scope_matches(s.ga4_property_id, p_ga4_property_id)
      AND s.report_date BETWEEN p_from AND p_to
      AND s.vdp_conditions IS TRUE
      AND s.page_path IS NOT NULL
      AND TRIM(s.page_path) <> ''
      AND (COALESCE(array_length(p_types, 1), 0) = 0 OR s.inv_type = ANY(p_types))
      AND (COALESCE(array_length(p_makes, 1), 0) = 0 OR s.inv_make = ANY(p_makes))
      AND (COALESCE(array_length(p_models, 1), 0) = 0 OR s.inv_model = ANY(p_models))
      AND (COALESCE(array_length(p_locations, 1), 0) = 0 OR s.inv_location = ANY(p_locations))
      AND (
        COALESCE(array_length(p_years, 1), 0) = 0
        OR (s.inv_year ~ '^\d{4}$' AND s.inv_year::int = ANY(p_years))
      )
      AND public.vdp_condition_matches(s.inv_condition, p_condition)
  ),
  -- One inventory/label row per path (best populated inventory wins)
  path_meta AS (
    SELECT DISTINCT ON (f.page_path)
      f.page_path,
      f.page_url,
      f.page_title AS final_page_title,
      f.inv_condition,
      f.inv_year,
      f.inv_make,
      f.inv_model,
      f.inv_trim,
      f.inv_type,
      f.inv_location,
      f.inv_stock_number,
      f.dealer_name
    FROM final_paths f
    ORDER BY
      f.page_path,
      (
        (f.inv_make IS NOT NULL)::int
        + (f.inv_model IS NOT NULL)::int
        + (f.inv_year IS NOT NULL)::int
        + (f.inv_condition IS NOT NULL)::int
        + (f.page_title IS NOT NULL)::int
      ) DESC,
      f.report_date DESC
  ),
  joined AS (
    SELECT
      f.page_path,
      f.page_url,
      NULLIF(TRIM(p.page_title), '') AS ga4_page_title,
      regexp_replace(
        lower(trim(COALESCE(p.channel, ''))),
        '[\s/-]+',
        '_',
        'g'
      ) AS channel_raw,
      lower(trim(COALESCE(p.source, ''))) AS source_raw,
      COALESCE(p.views, 0)::bigint AS views
    FROM final_paths f
    JOIN public.smart_ga4_page_data p
      ON p.client_id = f.client_id
     AND p.report_date = f.report_date
     AND p.page_path = f.page_path
     AND public.ga4_property_scope_matches(p.ga4_property_id, p_ga4_property_id)
     AND (p.vdp_conditions IS TRUE OR p.ga4_page_type ILIKE 'VDP%')
     AND (
       COALESCE(array_length(p_channels, 1), 0) = 0
       OR public.vdp_channel_matches(p.channel, p_channels)
     )
  ),
  bucketed AS (
    SELECT
      j.page_path,
      j.page_url,
      j.ga4_page_title,
      CASE
        WHEN j.source_raw LIKE '%facebook%'
          OR j.source_raw LIKE '%fb%'
          OR j.channel_raw IN ('paid_social', 'organic_social')
          THEN 'facebook'
        WHEN j.channel_raw IN ('organic_search', 'organicsearch')
          THEN 'organic_search'
        WHEN j.channel_raw = 'direct'
          THEN 'direct'
        WHEN j.channel_raw IN (
          'paid_search',
          'paidsearch',
          'cross_network',
          'crossnetwork',
          'display'
        )
          THEN 'paid_search'
        WHEN j.channel_raw = 'referral'
          THEN 'referral'
        ELSE 'other'
      END AS bucket,
      j.views
    FROM joined j
  ),
  pivoted AS (
    SELECT
      b.page_path,
      MAX(NULLIF(TRIM(b.page_url), '')) AS page_url,
      -- Prefer clean English GA4 titles only (no CJK / Cyrillic / Greek / etc.)
      (
        ARRAY_AGG(
          b.ga4_page_title
          ORDER BY
            CASE
              WHEN b.ga4_page_title ~* '^(new|used)\s+[0-9]{4}\b' THEN 0
              WHEN b.ga4_page_title ~* '^(new|used)\b' THEN 1
              ELSE 2
            END,
            LENGTH(b.ga4_page_title) DESC
        ) FILTER (
          WHERE b.ga4_page_title IS NOT NULL
            AND b.ga4_page_title !~ '^https?://'
            AND b.ga4_page_title NOT LIKE '/%'
            -- ASCII only → drops Chinese / Greek / Cyrillic / Arabic / …
            AND b.ga4_page_title !~ '[^[:ascii:]]'
        )
      )[1] AS ga4_page_title,
      SUM(b.views) FILTER (WHERE b.bucket = 'organic_search')::bigint AS organic_search,
      SUM(b.views) FILTER (WHERE b.bucket = 'direct')::bigint AS direct,
      SUM(b.views) FILTER (WHERE b.bucket = 'paid_search')::bigint AS paid_search,
      SUM(b.views) FILTER (WHERE b.bucket = 'facebook')::bigint AS facebook,
      SUM(b.views) FILTER (WHERE b.bucket = 'referral')::bigint AS referral,
      SUM(b.views)::bigint AS total_views
    FROM bucketed b
    GROUP BY b.page_path
  ),
  labeled AS (
    SELECT
      p.page_path,
      COALESCE(p.page_url, m.page_url) AS page_url,
      COALESCE(p.organic_search, 0) AS organic_search,
      COALESCE(p.direct, 0) AS direct,
      COALESCE(p.paid_search, 0) AS paid_search,
      COALESCE(p.facebook, 0) AS facebook,
      COALESCE(p.referral, 0) AS referral,
      COALESCE(p.total_views, 0) AS total_views,
      COALESCE(
        -- 1) Clean English GA4 title
        NULLIF(TRIM(p.ga4_page_title), ''),
        -- 2) Clean English title from final (same ASCII check)
        CASE
          WHEN m.final_page_title IS NOT NULL
           AND m.final_page_title !~ '^https?://'
           AND m.final_page_title NOT LIKE '/%'
           AND m.final_page_title !~ '[^[:ascii:]]'
          THEN m.final_page_title
          ELSE NULL
        END,
        -- 3) Inventory-built English title (screenshot style)
        NULLIF(
          TRIM(BOTH ' |' FROM CONCAT_WS(
            ' | ',
            NULLIF(
              TRIM(CONCAT_WS(
                ' ',
                CASE
                  WHEN m.inv_condition ILIKE 'new%' THEN 'New'
                  WHEN m.inv_condition ILIKE 'used%' OR m.inv_condition ILIKE 'pre%' THEN 'Used'
                  ELSE INITCAP(LOWER(m.inv_condition))
                END,
                m.inv_year,
                m.inv_make,
                m.inv_model,
                m.inv_trim,
                m.inv_type,
                CASE
                  WHEN m.dealer_name IS NOT NULL THEN 'at ' || m.dealer_name
                  ELSE NULL
                END
              )),
              ''
            ),
            m.inv_location,
            CASE
              WHEN m.inv_stock_number IS NOT NULL THEN '#' || m.inv_stock_number
              ELSE NULL
            END
          )),
          ''
        ),
        -- 4) Humanize last path segment (ASCII slug)
        INITCAP(
          TRIM(
            regexp_replace(
              regexp_replace(
                regexp_replace(
                  regexp_replace(
                    COALESCE(
                      NULLIF(substring(m.page_path from '([^/]+)/?$'), ''),
                      m.page_path
                    ),
                    '[-_]+',
                    ' ',
                    'g'
                  ),
                  '\s+for sale\s*',
                  ' ',
                  'i'
                ),
                '\b(inventory|product|en|fr|new|used|vehicles?)\b',
                '',
                'gi'
              ),
              '\s+',
              ' ',
              'g'
            )
          )
        )
      ) AS page_title
    FROM pivoted p
    LEFT JOIN path_meta m ON m.page_path = p.page_path
    WHERE COALESCE(p.total_views, 0) > 0
  ),
  ranked AS (
    SELECT
      l.page_title,
      l.page_path,
      l.page_url,
      l.organic_search,
      l.direct,
      l.paid_search,
      l.facebook,
      l.referral,
      l.total_views,
      ROW_NUMBER() OVER (ORDER BY l.total_views DESC, l.page_title ASC)::int AS rank
    FROM labeled l
  )
  SELECT
    r.page_title,
    r.page_path,
    r.page_url,
    r.organic_search,
    r.direct,
    r.paid_search,
    r.facebook,
    r.referral,
    r.total_views,
    r.rank
  FROM ranked r
  WHERE p_limit IS NULL OR r.rank <= p_limit
  ORDER BY r.rank;
$$;

COMMENT ON FUNCTION public.get_vdp_page_title_by_channel(
  text, date, date, int, text[], text[], text[], text[], integer[], text, text[], text
) IS
  'VDP page×channel matrix. Titles: clean ASCII English only (drops CJK/Cyrillic/Greek); else inventory/path. Paid Search = paid+cross+display.';

REVOKE ALL ON FUNCTION public.get_vdp_page_title_by_channel(
  text, date, date, int, text[], text[], text[], text[], integer[], text, text[], text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_vdp_page_title_by_channel(
  text, date, date, int, text[], text[], text[], text[], integer[], text, text[], text
) TO anon, authenticated, service_role;
