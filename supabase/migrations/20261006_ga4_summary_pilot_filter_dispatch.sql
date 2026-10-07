-- GA4 summary pilot: channel / inventory filter functions for pilot dealers read
-- ga4_sum_page_rows() instead of smart_ga4_page_data.
--   <fn>_legacy : exact copy of the original body (every non-pilot dealer, and pilot ranges
--                 with more than 7 uncovered days, e.g. pre-2026)
--   <fn>_pilot  : same body with smart_ga4_page_data p -> ga4_sum_page_rows(...) p
--   <fn>        : dispatcher, same signature, so callers are unchanged
-- Re-runnable: when <fn>_legacy already exists it is the source, never the dispatcher.

-- vdp_location_filter_match depends only on the inv_location value, so the matching values
-- are resolved once per call instead of once per row.
CREATE OR REPLACE FUNCTION public.vdp_location_allowed(
  p_client_id text, p_from date, p_to date, p_locations text[]
)
RETURNS text[]
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  -- MATERIALIZED keeps the match below from being pushed into the scan (once per row).
  WITH d AS MATERIALIZED (
    SELECT DISTINCT COALESCE(f.inv_location, '') AS loc
    FROM public.smart_final_data f
    WHERE f.client_id::text = btrim(p_client_id)
      AND f.report_date BETWEEN p_from AND p_to
  )
  SELECT COALESCE(array_agg(d.loc), ARRAY[]::text[])
  FROM d
  WHERE public.vdp_location_filter_match(btrim(p_client_id), NULLIF(d.loc, ''), p_locations);
$$;

REVOKE ALL ON FUNCTION public.vdp_location_allowed(text, date, date, text[]) FROM PUBLIC, anon, authenticated;

DO $gen$
DECLARE
  r           record;
  v_src       text;
  v_pilot     text;
  v_args_def  text;
  v_ident     text;
  v_names     text;
  v_res       text;
  v_is_set    boolean;
  v_legacy_ok boolean;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, p.proargnames, p.proargmodes, oidvectortypes(p.proargtypes) AS argtypes
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.oid::regprocedure::text IN (
        'get_vdp_views_total(text,date,date,text[],text[],text[],text[],integer[],text,text[])',
        'get_vdp_views_by_date(text,date,date,text[],text[],text[],text[],integer[],text,text[])',
        'vdp_filter_inventory_pool(text,date,date,text[],text[],text[],text[],integer[],text,text[],text)',
        'get_location_breakdown(text,date,date,integer,text[],text[],text[],text[],integer[],text,text[],text)',
        'get_make_breakdown(text,date,date,integer,text[],text[],text[],text[],integer[],text,text[],text)',
        'get_model_breakdown(text,date,date,integer,text[],text[],text[],text[],integer[],text,text[],text)',
        'get_year_breakdown(text,date,date,integer,text[],text[],text[],text[],integer[],text,text[],text)',
        'get_type_breakdown(text,date,date,integer,text[],text[],text[],text[],integer[],text,text[],text)',
        'get_condition_breakdown(text,date,date,integer,text[],text[],text[],text[],integer[],text,text[],text)',
        'get_ga4_channel_breakdown(text,date,date,text,text[],text[],text[],text,text[],text[],integer[],text[],text)',
        'get_vdp_export_by_channel(text,date,date,text[],text[],text[],text[],integer[],text,text[])',
        'get_vdp_export_by_condition(text,date,date,text[],text[],text[],text[],integer[],text,text[])',
        'get_vdp_export_by_location(text,date,date,text[],text[],text[],text[],integer[],text,text[])',
        'get_vdp_export_by_make(text,date,date,text[],text[],text[],text[],integer[],text,text[])',
        'get_vdp_export_by_model(text,date,date,text[],text[],text[],text[],integer[],text,text[])'
      )
  LOOP
    v_args_def := pg_get_function_arguments(r.oid);
    v_ident    := pg_get_function_identity_arguments(r.oid);
    v_res      := pg_get_function_result(r.oid);
    v_is_set   := v_res LIKE 'TABLE(%' OR v_res LIKE 'SETOF %';

    SELECT string_agg(quote_ident(t.nm), ', ' ORDER BY t.i)
      INTO v_names
      FROM unnest(
             r.proargnames,
             COALESCE(r.proargmodes, array_fill('i'::"char", ARRAY[array_length(r.proargnames, 1)]))
           ) WITH ORDINALITY AS t(nm, md, i)
     WHERE t.md IN ('i', 'b');

    v_legacy_ok := to_regprocedure(format('public.%I(%s)', r.proname || '_legacy', r.argtypes)) IS NOT NULL;

    IF v_legacy_ok THEN
      v_src := pg_get_functiondef(to_regprocedure(format('public.%I(%s)', r.proname || '_legacy', r.argtypes)));
    ELSE
      v_src := regexp_replace(pg_get_functiondef(r.oid),
                              'FUNCTION public\.' || r.proname || '\(',
                              'FUNCTION public.' || r.proname || '_legacy(');
      EXECUTE v_src;
    END IF;

    v_pilot := regexp_replace(v_src,
                              'FUNCTION public\.' || r.proname || '_legacy\(',
                              'FUNCTION public.' || r.proname || '_pilot(');
    v_pilot := regexp_replace(v_pilot,
                              '(public\.)?smart_ga4_page_data\s+p\M',
                              'public.ga4_sum_page_rows(btrim(p_client_id), p_from, p_to) p',
                              'g');
    v_pilot := replace(v_pilot,
                       'public.vdp_channel_matches(p.channel, p_channels)',
                       '(COALESCE(array_length(p_channels, 1), 0) = 0 OR p.channel_key = ANY ((SELECT public.vdp_channel_keys(p_channels))::text[]))');
    v_pilot := regexp_replace(v_pilot,
                              'public\.vdp_location_filter_match\(\s*(trim\(p_client_id\)|v_client)\s*,\s*((?:[a-z_]+\.)?inv_location)\s*,\s*p_locations\s*\)',
                              '(COALESCE(array_length(p_locations, 1), 0) = 0 OR COALESCE(\2, '''') = ANY ((SELECT public.vdp_location_allowed(\1, p_from, p_to, p_locations))::text[]))',
                              'g');
    IF v_pilot ~ 'vdp_location_filter_match' THEN
      RAISE EXCEPTION 'unreplaced vdp_location_filter_match call in %', r.proname;
    END IF;
    IF v_pilot ~ 'smart_ga4_page_data' THEN
      RAISE EXCEPTION 'unreplaced smart_ga4_page_data reference in %', r.proname;
    END IF;
    EXECUTE v_pilot;

    IF v_is_set THEN
      EXECUTE format($f$
        CREATE OR REPLACE FUNCTION public.%I(%s)
         RETURNS %s
         LANGUAGE plpgsql
         STABLE SECURITY DEFINER
         SET search_path TO 'public'
        AS $d$
        BEGIN
          IF public.ga4_vdp_path_usable(p_client_id, p_from, p_to) THEN
            RETURN QUERY SELECT * FROM public.%I(%s);
          ELSE
            RETURN QUERY SELECT * FROM public.%I(%s);
          END IF;
        END;
        $d$$f$,
        r.proname, v_args_def, v_res,
        r.proname || '_pilot', v_names,
        r.proname || '_legacy', v_names);
    ELSE
      EXECUTE format($f$
        CREATE OR REPLACE FUNCTION public.%I(%s)
         RETURNS %s
         LANGUAGE plpgsql
         STABLE SECURITY DEFINER
         SET search_path TO 'public'
        AS $d$
        BEGIN
          IF public.ga4_vdp_path_usable(p_client_id, p_from, p_to) THEN
            RETURN public.%I(%s);
          END IF;
          RETURN public.%I(%s);
        END;
        $d$$f$,
        r.proname, v_args_def, v_res,
        r.proname || '_pilot', v_names,
        r.proname || '_legacy', v_names);
    END IF;

    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated',
                   r.proname || '_legacy', v_ident);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated',
                   r.proname || '_pilot', v_ident);
  END LOOP;
END
$gen$;
