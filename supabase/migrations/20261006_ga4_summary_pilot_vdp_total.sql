-- GA4 summary pilot: serve the VDP-views total (used to scale every inventory
-- breakdown) from smart_sum_ga4_channel_daily for pilot dealers.
-- Returns NULL for non-pilot dealers or poorly covered ranges, so
-- get_vdp_views_total falls through to its original logic unchanged.

CREATE OR REPLACE FUNCTION public.vdp_views_total_summary(
  p_client_id text, p_from date, p_to date, p_channels text[] DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_client  text := btrim(p_client_id);
  v_missing date[];
  v_total   bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM smart_sum_pilot p WHERE p.client_id = v_client AND p.enabled) THEN
    RETURN NULL;
  END IF;

  v_missing := public.ga4_summary_uncovered_days(v_client, p_from, p_to);
  IF COALESCE(array_length(v_missing, 1), 0) > 7 THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(x.views), 0)::bigint INTO v_total
  FROM (
    SELECT s.views
    FROM smart_sum_ga4_channel_daily s
    WHERE s.client_id = v_client
      AND s.report_date BETWEEN p_from AND p_to
      AND NOT (s.report_date = ANY (v_missing))
      AND s.is_vdp
      AND (COALESCE(array_length(p_channels, 1), 0) = 0
           OR public.vdp_channel_matches(NULLIF(s.channel, ''), p_channels))
    UNION ALL
    SELECT COALESCE(g.views, 0)::bigint
    FROM smart_ga4_page_data g
    WHERE g.client_id = v_client
      AND g.report_date = ANY (v_missing)
      AND g.vdp_conditions IS TRUE
      AND (COALESCE(array_length(p_channels, 1), 0) = 0
           OR public.vdp_channel_matches(g.channel, p_channels))
  ) x;

  RETURN v_total;
END;
$function$;

REVOKE ALL ON FUNCTION public.vdp_views_total_summary(text, date, date, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vdp_views_total_summary(text, date, date, text[]) TO service_role;

CREATE OR REPLACE FUNCTION public.get_vdp_views_total(p_client_id text, p_from date, p_to date, p_types text[] DEFAULT NULL::text[], p_makes text[] DEFAULT NULL::text[], p_models text[] DEFAULT NULL::text[], p_locations text[] DEFAULT NULL::text[], p_years integer[] DEFAULT NULL::integer[], p_condition text DEFAULT 'BOTH'::text, p_channels text[] DEFAULT NULL::text[])
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '55s'
AS $function$
DECLARE
  v_client text := trim(p_client_id);
  v_condition text := UPPER(COALESCE(p_condition, 'BOTH'));
  v_inv boolean;
  v_total bigint;
BEGIN
  v_inv :=
       COALESCE(array_length(p_types, 1), 0) > 0
    OR COALESCE(array_length(p_makes, 1), 0) > 0
    OR COALESCE(array_length(p_models, 1), 0) > 0
    OR COALESCE(array_length(p_locations, 1), 0) > 0
    OR COALESCE(array_length(p_years, 1), 0) > 0
    OR v_condition <> 'BOTH';

  IF NOT v_inv THEN
    v_total := public.vdp_views_total_summary(v_client, p_from, p_to, p_channels);
    IF v_total IS NOT NULL THEN
      RETURN v_total;
    END IF;
  END IF;

  IF COALESCE(array_length(p_channels, 1), 0) > 0 THEN
    IF NOT v_inv THEN
      SELECT COALESCE(SUM(COALESCE(p.views, 0)), 0)::bigint
      INTO v_total
      FROM public.smart_ga4_page_data p
      WHERE p.client_id::text = v_client
        AND p.report_date BETWEEN p_from AND p_to
        AND p.vdp_conditions IS TRUE
        AND public.vdp_channel_matches(p.channel, p_channels);
    ELSE
      SELECT COALESCE(SUM(COALESCE(p.views, 0)), 0)::bigint
      INTO v_total
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
    AND public.vdp_condition_matches(f.inv_condition, p_condition);

  RETURN COALESCE(v_total, 0);
END;
$function$;
