-- Fast VDP daily series (same channel strategy as get_vdp_views_total).

DROP FUNCTION IF EXISTS public.get_vdp_views_by_date(text, date, date);
DROP FUNCTION IF EXISTS public.get_vdp_views_by_date(text, date, date, text[], text[], text[], text[], integer[], text);
DROP FUNCTION IF EXISTS public.get_vdp_views_by_date(text, date, date, text[], text[], text[], text[], integer[], text, text[]);

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
  p_channels text[] DEFAULT NULL
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
BEGIN
  v_inv :=
       COALESCE(array_length(p_types, 1), 0) > 0
    OR COALESCE(array_length(p_makes, 1), 0) > 0
    OR COALESCE(array_length(p_models, 1), 0) > 0
    OR COALESCE(array_length(p_locations, 1), 0) > 0
    OR COALESCE(array_length(p_years, 1), 0) > 0
    OR v_condition <> 'BOTH';

  IF COALESCE(array_length(p_channels, 1), 0) > 0 THEN
    IF NOT v_inv THEN
      RETURN QUERY
      SELECT
        p.report_date,
        COALESCE(SUM(COALESCE(p.views, 0)), 0)::bigint AS views
      FROM public.smart_ga4_page_data p
      WHERE p.client_id::text = v_client
        AND p.report_date BETWEEN p_from AND p_to
        AND p.vdp_conditions IS TRUE
        AND public.vdp_channel_matches(p.channel, p_channels)
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
        AND public.vdp_channel_matches(p.channel, p_channels)
        AND EXISTS (
          SELECT 1
          FROM public.smart_final_data f
          WHERE f.client_id::text = v_client
            AND f.report_date = p.report_date
            AND f.page_path = p.page_path
            AND (COALESCE(array_length(p_types, 1), 0) = 0 OR f.inv_type = ANY(p_types))
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

  RETURN QUERY
  SELECT
    f.report_date,
    COALESCE(SUM(COALESCE(f.views, 0)), 0)::bigint AS views
  FROM public.smart_final_data f
  WHERE f.client_id::text = v_client
    AND f.report_date BETWEEN p_from AND p_to
    AND (COALESCE(array_length(p_types, 1), 0) = 0 OR f.inv_type = ANY(p_types))
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
  text, date, date, text[], text[], text[], text[], integer[], text, text[]
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_vdp_views_by_date(
  text, date, date, text[], text[], text[], text[], integer[], text, text[]
) TO anon, authenticated, service_role;
