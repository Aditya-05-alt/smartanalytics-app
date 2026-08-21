
-- FILE get_make_breakdown.sql

-- Frontend-safe make breakdown RPC.
-- IMPORTANT: Use SECURITY DEFINER so anon/authenticated can execute even when
-- smart_final_data is protected by RLS.

DROP FUNCTION IF EXISTS public.get_make_breakdown(text, date, date);
DROP FUNCTION IF EXISTS public.get_make_breakdown(text, date, date, int);
DROP FUNCTION IF EXISTS public.get_make_breakdown(text, date, date, int, integer[]);
DROP FUNCTION IF EXISTS public.get_make_breakdown(text, date, date, int, text[], text[], text[], text[], integer[], text);
DROP FUNCTION IF EXISTS public.get_make_breakdown(text, date, date, int, text[], text[], text[], text[], integer[], text, text[]);

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
  p_channels text[] DEFAULT NULL
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
AS $$
  WITH base AS (
    SELECT
      COALESCE(NULLIF(TRIM(inv_make), ''), 'Unknown') AS make_bucket,
      COALESCE(views, 0)::bigint AS views
    FROM smart_final_data
    WHERE client_id::text = trim(p_client_id)
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
      AND (
        UPPER(COALESCE(p_condition, 'BOTH')) = 'BOTH'
        OR UPPER(inv_condition) = UPPER(p_condition)
      )
    AND public.vdp_final_matches_channels(
      trim(p_client_id), report_date, page_path, p_channels
    )
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
  text, date, date, int, text[], text[], text[], text[], integer[], text, text[]
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_make_breakdown(
  text, date, date, int, text[], text[], text[], text[], integer[], text, text[]
) TO anon, authenticated, service_role;


-- FILE get_model_breakdown.sql

-- Model breakdown from smart_final_data (VDP tab). Deploy in Supabase SQL editor.

DROP FUNCTION IF EXISTS public.get_model_breakdown(text, date, date, int);
DROP FUNCTION IF EXISTS public.get_model_breakdown(text, date, date, int, integer[]);
DROP FUNCTION IF EXISTS public.get_model_breakdown(text, date, date, int, text[], text[], text[], text[], integer[], text);
DROP FUNCTION IF EXISTS public.get_model_breakdown(text, date, date, int, text[], text[], text[], text[], integer[], text, text[]);

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
  p_channels text[] DEFAULT NULL
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
AS $$
  WITH base AS (
    SELECT
      COALESCE(NULLIF(TRIM(inv_model), ''), 'Unknown') AS model_bucket,
      COALESCE(NULLIF(TRIM(inv_make), ''), '') AS make_bucket,
      COALESCE(views, 0)::bigint AS views
    FROM smart_final_data
    WHERE client_id::text = trim(p_client_id)
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
      AND (
        UPPER(COALESCE(p_condition, 'BOTH')) = 'BOTH'
        OR UPPER(inv_condition) = UPPER(p_condition)
      )
    AND public.vdp_final_matches_channels(
      trim(p_client_id), report_date, page_path, p_channels
    )
  ),
  agg AS (
    SELECT model_bucket, make_bucket, SUM(views)::bigint AS views
    FROM base
    GROUP BY model_bucket, make_bucket
  ),
  ranked AS (
    SELECT *, ROW_NUMBER() OVER (ORDER BY views DESC, model_bucket) AS rn
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
    SELECT NULLIF(SUM(views), 0)::numeric AS total FROM combined
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

GRANT EXECUTE ON FUNCTION public.get_model_breakdown(
  text, date, date, int, text[], text[], text[], text[], integer[], text, text[]
) TO anon, authenticated, service_role;


-- FILE get_year_breakdown.sql

-- Year breakdown from smart_final_data (VDP tab). Deploy in Supabase SQL editor.

DROP FUNCTION IF EXISTS public.get_year_breakdown(text, date, date, int);
DROP FUNCTION IF EXISTS public.get_year_breakdown(text, date, date, int, integer[]);
DROP FUNCTION IF EXISTS public.get_year_breakdown(text, date, date, int, text[], text[], text[], text[], integer[], text);
DROP FUNCTION IF EXISTS public.get_year_breakdown(text, date, date, int, text[], text[], text[], text[], integer[], text, text[]);

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
  p_channels text[] DEFAULT NULL
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
AS $$
  WITH base AS (
    SELECT
      COALESCE(NULLIF(TRIM(inv_year), ''), 'Unknown') AS year_bucket,
      COALESCE(views, 0)::bigint AS views
    FROM smart_final_data
    WHERE client_id::text = trim(p_client_id)
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
      AND (
        UPPER(COALESCE(p_condition, 'BOTH')) = 'BOTH'
        OR UPPER(inv_condition) = UPPER(p_condition)
      )
    AND public.vdp_final_matches_channels(
      trim(p_client_id), report_date, page_path, p_channels
    )
  ),
  agg AS (
    SELECT year_bucket, SUM(views)::bigint AS views
    FROM base
    GROUP BY year_bucket
  ),
  ranked AS (
    SELECT *, ROW_NUMBER() OVER (ORDER BY views DESC, year_bucket DESC) AS rn
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
    SELECT NULLIF(SUM(views), 0)::numeric AS total FROM combined
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

GRANT EXECUTE ON FUNCTION public.get_year_breakdown(
  text, date, date, int, text[], text[], text[], text[], integer[], text, text[]
) TO anon, authenticated, service_role;


-- FILE get_condition_breakdown.sql

-- Condition breakdown from smart_final_data (VDP tab). Deploy in Supabase SQL editor.

DROP FUNCTION IF EXISTS public.get_condition_breakdown(text, date, date, int);
DROP FUNCTION IF EXISTS public.get_condition_breakdown(text, date, date, int, integer[]);
DROP FUNCTION IF EXISTS public.get_condition_breakdown(text, date, date, int, text[], text[], text[], text[], integer[], text);
DROP FUNCTION IF EXISTS public.get_condition_breakdown(text, date, date, int, text[], text[], text[], text[], integer[], text, text[]);

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
  p_channels text[] DEFAULT NULL
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
AS $$
  WITH base AS (
    SELECT
      COALESCE(NULLIF(TRIM(inv_condition), ''), 'Unknown') AS condition_bucket,
      COALESCE(views, 0)::bigint AS views
    FROM smart_final_data
    WHERE client_id::text = trim(p_client_id)
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
      AND (
        UPPER(COALESCE(p_condition, 'BOTH')) = 'BOTH'
        OR UPPER(inv_condition) = UPPER(p_condition)
      )
    AND public.vdp_final_matches_channels(
      trim(p_client_id), report_date, page_path, p_channels
    )
  ),
  agg AS (
    SELECT condition_bucket, SUM(views)::bigint AS views
    FROM base
    GROUP BY condition_bucket
  ),
  ranked AS (
    SELECT *, ROW_NUMBER() OVER (ORDER BY views DESC, condition_bucket) AS rn
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
    SELECT NULLIF(SUM(views), 0)::numeric AS total FROM combined
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

GRANT EXECUTE ON FUNCTION public.get_condition_breakdown(
  text, date, date, int, text[], text[], text[], text[], integer[], text, text[]
) TO anon, authenticated, service_role;


-- FILE get_type_breakdown.sql

-- Type breakdown from smart_final_data (VDP tab).
-- Prefers inv_custom_type (from type_ or dealer raw_data key). Falls back to inv_type.
-- Deploy AFTER: supabase/migrations/smart_final_data_inv_custom_type.sql

DROP FUNCTION IF EXISTS public.get_type_breakdown(text, date, date);
DROP FUNCTION IF EXISTS public.get_type_breakdown(text, date, date, int);
DROP FUNCTION IF EXISTS public.get_type_breakdown(text, date, date, int, text[], text[], text[], text[], integer[], text);
DROP FUNCTION IF EXISTS public.get_type_breakdown(text, date, date, int, text[], text[], text[], text[], integer[], text, text[]);

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
  p_channels text[] DEFAULT NULL
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
AS $$
  WITH base AS (
    SELECT
      COALESCE(
        NULLIF(TRIM(s.inv_custom_type), ''),
        NULLIF(TRIM(s.inv_type), ''),
        'Unknown'
      ) AS type_bucket,
      COALESCE(s.views, 0)::bigint AS views
    FROM smart_final_data s
    WHERE s.client_id::text = trim(p_client_id)
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
      AND (
        UPPER(COALESCE(p_condition, 'BOTH')) = 'BOTH'
        OR UPPER(s.inv_condition) = UPPER(p_condition)
      )
      AND public.vdp_final_matches_channels(
        trim(p_client_id), s.report_date, s.page_path, p_channels
      )
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
  text, date, date, int, text[], text[], text[], text[], integer[], text, text[]
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_type_breakdown(
  text, date, date, int, text[], text[], text[], text[], integer[], text, text[]
) TO anon, authenticated, service_role;


-- FILE get_location_breakdown.sql

-- Location breakdown from smart_final_data (VDP tab).
-- Uses the same inventory filter contract as get_make_breakdown / get_type_breakdown.
-- Location filter (p_locations) applies to all dimensions including this chart.
-- Deploy in Supabase SQL editor.

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
AS $$
  WITH base AS (
    SELECT
      COALESCE(NULLIF(TRIM(inv_location), ''), 'Unknown') AS location_bucket,
      COALESCE(views, 0)::bigint AS views
    FROM smart_final_data
    WHERE client_id::text = trim(p_client_id)
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
      AND (
        UPPER(COALESCE(p_condition, 'BOTH')) = 'BOTH'
        OR UPPER(inv_condition) = UPPER(p_condition)
      )
    AND public.vdp_final_matches_channels(
      trim(p_client_id), report_date, page_path, p_channels
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

REVOKE ALL ON FUNCTION public.get_location_breakdown(
  text, date, date, int, text[], text[], text[], text[], integer[], text, text[]
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_location_breakdown(
  text, date, date, int, text[], text[], text[], text[], integer[], text, text[]
) TO anon, authenticated, service_role;
