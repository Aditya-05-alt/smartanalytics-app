-- Dealers whose Step 3 inventory comes from the Conner tables (Scout RV / ScoutX VLA feeds).
-- A dealer is Conner when it has an active smart_conner_config row with a feed URL.
-- smart-master-sync (Hoot) and smart-master-sync-scrap skip these dealers;
-- smart-conner-final-data builds them.

CREATE OR REPLACE FUNCTION public.get_conner_dealers_for_sync(p_client_id text DEFAULT NULL)
RETURNS TABLE(
  conner_config_id bigint,
  customer_name    text,
  ga4_customer_id  text,
  website_platform text,
  feed_url         text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT DISTINCT ON (btrim(c.ga4_customer_id::text))
    c.id::bigint,
    c.customer_name,
    btrim(c.ga4_customer_id::text),
    c.website_platform,
    c.hoot_url
  FROM public.smart_conner_config c
  WHERE c.is_active IS TRUE
    AND NULLIF(btrim(c.ga4_customer_id::text), '') IS NOT NULL
    AND NULLIF(btrim(c.hoot_url), '') IS NOT NULL
    AND (p_client_id IS NULL OR btrim(c.ga4_customer_id::text) = btrim(p_client_id))
  ORDER BY btrim(c.ga4_customer_id::text), c.id DESC;
$function$;

REVOKE ALL ON FUNCTION public.get_conner_dealers_for_sync(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_conner_dealers_for_sync(text) TO service_role;
