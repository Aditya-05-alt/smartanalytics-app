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
      COALESCE(NULLIF(TRIM(f.inv_make), ''), 'Other') AS make_bucket,
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
      COALESCE(NULLIF(TRIM(inv_make), ''), 'Other') AS make_bucket,
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
      COALESCE(NULLIF(TRIM(f.inv_model), ''), 'Other') AS model_bucket,
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
      COALESCE(NULLIF(TRIM(inv_model), ''), 'Other') AS model_bucket,
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
      COALESCE(NULLIF(TRIM(f.inv_year), ''), 'Other') AS year_bucket,
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
      COALESCE(NULLIF(TRIM(inv_year), ''), 'Other') AS year_bucket,
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
        'Other'
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
      COALESCE(NULLIF(TRIM(f.inv_condition), ''), 'Other') AS condition_bucket,
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
      COALESCE(NULLIF(TRIM(inv_condition), ''), 'Other') AS condition_bucket,
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
      COALESCE(NULLIF(TRIM(f.inv_location), ''), 'Other') AS location_bucket,
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
      COALESCE(NULLIF(TRIM(inv_location), ''), 'Other') AS location_bucket,
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
