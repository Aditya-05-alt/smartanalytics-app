-- Fast VDP KPI total.
-- No channel/source → smart_final_data (or unfiltered GA4 when no inventory).
-- With channel and/or source → sum smart_ga4_page_data.views, optional inventory via path join.

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
  p_sources text[] DEFAULT NULL
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
  v_has_channels boolean;
  v_has_sources boolean;
  v_total bigint;
BEGIN
  v_inv :=
       COALESCE(array_length(p_types, 1), 0) > 0
    OR COALESCE(array_length(p_makes, 1), 0) > 0
    OR COALESCE(array_length(p_models, 1), 0) > 0
    OR COALESCE(array_length(p_locations, 1), 0) > 0
    OR COALESCE(array_length(p_years, 1), 0) > 0
    OR v_condition <> 'BOTH';

  v_has_channels := COALESCE(array_length(p_channels, 1), 0) > 0;
  v_has_sources := COALESCE(array_length(p_sources, 1), 0) > 0;

  IF v_has_channels OR v_has_sources THEN
    IF NOT v_inv THEN
      -- Source-only: equality on source (index-friendly). Channel uses helper.
      IF v_has_sources AND NOT v_has_channels THEN
        SELECT COALESCE(SUM(COALESCE(p.views, 0)), 0)::bigint
        INTO v_total
        FROM public.smart_ga4_page_data p
        WHERE p.client_id = v_client
          AND p.report_date BETWEEN p_from AND p_to
          AND p.vdp_conditions IS TRUE
          AND public.vdp_source_matches(p.source, p_sources);
      ELSE
        SELECT COALESCE(SUM(COALESCE(p.views, 0)), 0)::bigint
        INTO v_total
        FROM public.smart_ga4_page_data p
        WHERE p.client_id = v_client
          AND p.report_date BETWEEN p_from AND p_to
          AND p.vdp_conditions IS TRUE
          AND (NOT v_has_channels OR public.vdp_channel_matches(p.channel, p_channels))
          AND (NOT v_has_sources OR public.vdp_source_matches(p.source, p_sources));
      END IF;
    ELSE
      SELECT COALESCE(SUM(COALESCE(p.views, 0)), 0)::bigint
      INTO v_total
      FROM public.smart_ga4_page_data p
      WHERE p.client_id = v_client
        AND p.report_date BETWEEN p_from AND p_to
        AND p.vdp_conditions IS TRUE
        AND (NOT v_has_channels OR public.vdp_channel_matches(p.channel, p_channels))
        AND (NOT v_has_sources OR public.vdp_source_matches(p.source, p_sources))
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
    WHERE p.client_id = v_client
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
