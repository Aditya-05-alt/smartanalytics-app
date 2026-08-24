-- VDP export: date-wise rows per inv_url + model (XLSX "By Model" sheet).
-- URL from smart_final_data.inv_url. Deploy in Supabase SQL editor.

DROP FUNCTION IF EXISTS public.get_vdp_export_by_model(
  text, date, date, text[], text[], text[], text[], integer[], text
);
DROP FUNCTION IF EXISTS public.get_vdp_export_by_model(
  text, date, date, text[], text[], text[], text[], integer[], text, text[]
);

CREATE OR REPLACE FUNCTION public.get_vdp_export_by_model(
  p_client_id text,
  p_from date,
  p_to date,
  p_types text[] DEFAULT NULL,
  p_makes text[] DEFAULT NULL,
  p_models text[] DEFAULT NULL,
  p_locations text[] DEFAULT NULL,
  p_years integer[] DEFAULT NULL,
  p_condition text DEFAULT 'BOTH',
  p_channels text[] DEFAULT NULL
)
RETURNS TABLE (
  report_date date,
  url text,
  views bigint,
  model text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH filtered AS (
    SELECT
      f.report_date,
      CASE
        WHEN NULLIF(TRIM(f.inv_url), '') ~* '^https?://' THEN TRIM(f.inv_url)
        WHEN NULLIF(TRIM(f.page_location), '') ~* '^https?://'
             AND TRIM(f.page_location) !~* 'hootinteractive\.net' THEN TRIM(f.page_location)
        ELSE NULL
      END AS url,
      COALESCE(NULLIF(TRIM(f.inv_model), ''), 'Unknown') AS model,
      COALESCE(p.views, 0)::bigint AS v
    FROM smart_final_data f
    INNER JOIN smart_ga4_page_data p
      ON p.client_id::text = f.client_id::text
     AND p.report_date = f.report_date
     AND p.page_path = f.page_path
    WHERE COALESCE(array_length(p_channels, 1), 0) > 0
      AND f.client_id::text = trim(p_client_id)
      AND f.report_date BETWEEN p_from AND p_to
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
      report_date,
      CASE
        WHEN NULLIF(TRIM(inv_url), '') ~* '^https?://' THEN TRIM(inv_url)
        WHEN NULLIF(TRIM(page_location), '') ~* '^https?://'
             AND TRIM(page_location) !~* 'hootinteractive\.net' THEN TRIM(page_location)
        ELSE NULL
      END AS url,
      COALESCE(NULLIF(TRIM(inv_model), ''), 'Unknown') AS model,
      COALESCE(views, 0)::bigint AS v
    FROM smart_final_data
    WHERE COALESCE(array_length(p_channels, 1), 0) = 0
      AND client_id::text = trim(p_client_id)
      AND report_date BETWEEN p_from AND p_to
      AND (ga4_page_type ILIKE 'VDP%' OR vdp_conditions IS TRUE)
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
    SELECT report_date, url, model, SUM(v)::bigint AS views
    FROM filtered
    WHERE url IS NOT NULL AND url <> '' AND v > 0
    GROUP BY report_date, url, model
  )
  SELECT a.report_date, a.url, a.views, a.model
  FROM agg a
  WHERE a.views > 0
  ORDER BY a.report_date DESC, a.views DESC, a.url, a.model;
$$;

GRANT EXECUTE ON FUNCTION public.get_vdp_export_by_model(
  text, date, date, text[], text[], text[], text[], integer[], text, text[]
) TO anon, authenticated, service_role;
