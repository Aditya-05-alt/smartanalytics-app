-- smart_conner_config.hoot_url -> wheeler_url (Conner feeds are not Hoot).
-- smart_hoot_config.hoot_url is untouched. Dependents: get_conner_dealers_for_sync and
-- build_smart_final_data_conner (its output/CTE column stays named hoot_url, which maps to
-- smart_final_data.hoot_url).

ALTER TABLE public.smart_conner_config RENAME COLUMN hoot_url TO wheeler_url;

-- Sync feed list: feed_url is now returned as wheeler_url.
DROP FUNCTION IF EXISTS public.get_conner_dealers_for_sync(text);

CREATE FUNCTION public.get_conner_dealers_for_sync(p_client_id text DEFAULT NULL::text)
 RETURNS TABLE(conner_config_id bigint, customer_name text, ga4_customer_id text, website_platform text, wheeler_url text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT DISTINCT ON (btrim(c.ga4_customer_id::text))
    c.id::bigint,
    c.customer_name,
    btrim(c.ga4_customer_id::text),
    c.website_platform,
    c.wheeler_url
  FROM public.smart_conner_config c
  WHERE c.is_active IS TRUE
    AND NULLIF(btrim(c.ga4_customer_id::text), '') IS NOT NULL
    AND NULLIF(btrim(c.wheeler_url), '') IS NOT NULL
    AND (p_client_id IS NULL OR btrim(c.ga4_customer_id::text) = btrim(p_client_id))
  ORDER BY btrim(c.ga4_customer_id::text), c.id DESC;
$function$;

REVOKE ALL ON FUNCTION public.get_conner_dealers_for_sync(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_conner_dealers_for_sync(text) TO service_role;

-- Step 3: re-create the existing function with the renamed config column.
DO $mig$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  WHERE p.proname = 'build_smart_final_data_conner' AND p.pronamespace = 'public'::regnamespace;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'build_smart_final_data_conner not found';
  END IF;

  v_def := replace(v_def, 'NULLIF(btrim(c.hoot_url), '''')', 'NULLIF(btrim(c.wheeler_url), '''')');
  v_def := replace(v_def, 'NULLIF(btrim(h.hoot_url), '''')', 'NULLIF(btrim(h.wheeler_url), '''')');
  v_def := replace(v_def, E'h.hoot_url,\n', E'h.wheeler_url AS hoot_url,\n');

  IF v_def ~ 'h\.hoot_url' OR v_def ~ 'NULLIF\(btrim\(c\.hoot_url\)' THEN
    RAISE EXCEPTION 'build_smart_final_data_conner still references smart_conner_config.hoot_url';
  END IF;

  EXECUTE v_def;
END
$mig$;
