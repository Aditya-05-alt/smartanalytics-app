-- Align all VDP inventory breakdown totals to get_vdp_views_total (same filters).
-- Why totals diverged (esp. 2025 / early 2026):
--   Channel + unfiltered KPI â†’ smart_ga4_page_data (vdp_conditions)
--   Location/Year/Condition/Make/Model/Type â†’ smart_final_data (often incomplete vs GA4)
-- Fix: keep Final bucket mix, scale Î£ buckets to KPI target (GA4 when unfiltered,
-- Final when inventory-filtered). Applies to all dealers.

CREATE OR REPLACE FUNCTION public.vdp_scale_breakdown_to_kpi(
  p_buckets text[],
  p_views bigint[],
  p_ranks int[],
  p_target bigint
)
RETURNS TABLE (
  bucket text,
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
  n int;
  i int;
  v_raw bigint := 0;
  v_scaled bigint[];
  v_sum bigint := 0;
  v_max_i int := 1;
  v_target bigint := COALESCE(p_target, 0);
BEGIN
  n := COALESCE(array_length(p_buckets, 1), 0);
  IF n = 0 THEN
    IF v_target > 0 THEN
      bucket := 'Other';
      views := v_target;
      pct := 100.0;
      rank := 1;
      RETURN NEXT;
    END IF;
    RETURN;
  END IF;

  IF COALESCE(array_length(p_views, 1), 0) <> n
     OR COALESCE(array_length(p_ranks, 1), 0) <> n THEN
    RAISE EXCEPTION 'vdp_scale_breakdown_to_kpi: array length mismatch';
  END IF;

  FOR i IN 1..n LOOP
    v_raw := v_raw + COALESCE(p_views[i], 0);
  END LOOP;

  v_scaled := array_fill(0::bigint, ARRAY[n]);

  IF v_raw <= 0 THEN
    IF v_target > 0 THEN
      bucket := 'Other';
      views := v_target;
      pct := 100.0;
      rank := 1;
      RETURN NEXT;
    END IF;
    RETURN;
  END IF;

  IF v_target <= 0 THEN
    RETURN;
  END IF;

  FOR i IN 1..n LOOP
    v_scaled[i] := ROUND(
      COALESCE(p_views[i], 0)::numeric * v_target::numeric / v_raw::numeric
    )::bigint;
    v_sum := v_sum + v_scaled[i];
    IF v_scaled[i] > v_scaled[v_max_i]
       OR (v_scaled[i] = v_scaled[v_max_i] AND p_buckets[i] < p_buckets[v_max_i]) THEN
      v_max_i := i;
    END IF;
  END LOOP;

  -- Absorb ROUND drift on largest bucket
  v_scaled[v_max_i] := v_scaled[v_max_i] + (v_target - v_sum);

  FOR i IN 1..n LOOP
    IF v_scaled[i] > 0 THEN
      bucket := p_buckets[i];
      views := v_scaled[i];
      pct := ROUND(100.0 * v_scaled[i]::numeric / v_target::numeric, 2);
      rank := p_ranks[i];
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.vdp_scale_breakdown_to_kpi(text[], bigint[], int[], bigint) IS
  'Scale breakdown bucket views so SUM equals KPI target (get_vdp_views_total).';

GRANT EXECUTE ON FUNCTION public.vdp_scale_breakdown_to_kpi(text[], bigint[], int[], bigint)
  TO anon, authenticated, service_role;


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
  kpi AS (
    SELECT public.get_vdp_views_total(
      trim(p_client_id), p_from, p_to,
      p_types, p_makes, p_models, p_locations, p_years, p_condition, p_channels
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
  text, date, date, int, text[], text[], text[], text[], integer[], text, text[], text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_location_breakdown(
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
  kpi AS (
    SELECT public.get_vdp_views_total(
      trim(p_client_id), p_from, p_to,
      p_types, p_makes, p_models, p_locations, p_years, p_condition, p_channels
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
  text, date, date, int, text[], text[], text[], text[], integer[], text, text[], text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_year_breakdown(
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
  kpi AS (
    SELECT public.get_vdp_views_total(
      trim(p_client_id), p_from, p_to,
      p_types, p_makes, p_models, p_locations, p_years, p_condition, p_channels
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
  text, date, date, int, text[], text[], text[], text[], integer[], text, text[], text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_condition_breakdown(
  text, date, date, int, text[], text[], text[], text[], integer[], text, text[], text
) TO anon, authenticated, service_role;


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
  kpi AS (
    SELECT public.get_vdp_views_total(
      trim(p_client_id), p_from, p_to,
      p_types, p_makes, p_models, p_locations, p_years, p_condition, p_channels
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
  kpi AS (
    SELECT public.get_vdp_views_total(
      trim(p_client_id), p_from, p_to,
      p_types, p_makes, p_models, p_locations, p_years, p_condition, p_channels
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
  text, date, date, int, text[], text[], text[], text[], integer[], text, text[], text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_model_breakdown(
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
  kpi AS (
    SELECT public.get_vdp_views_total(
      trim(p_client_id), p_from, p_to,
      p_types, p_makes, p_models, p_locations, p_years, p_condition, p_channels
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
  text, date, date, int, text[], text[], text[], text[], integer[], text, text[], text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_type_breakdown(
  text, date, date, int, text[], text[], text[], text[], integer[], text, text[], text
) TO anon, authenticated, service_role;

