-- Dealers with a scrap_link in smart_vdp_logic (no inventory_source flag required).
-- Deploy in Supabase SQL editor.

DROP FUNCTION IF EXISTS public.get_scrap_dealers_for_sync(text);

CREATE OR REPLACE FUNCTION public.get_scrap_dealers_for_sync(
  p_client_id text DEFAULT NULL
)
RETURNS TABLE (
  hoot_config_id     bigint,
  customer_name      text,
  ga4_customer_id    text,
  website_platform   text,
  inventory_source   text,
  scrap_link         text,
  website_url        text,
  cms                text,
  vdp_logic          text,
  srp_logic          text,
  home_page_logic    text,
  data_source        text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    h.id AS hoot_config_id,
    h.customer_name,
    trim(h.ga4_customer_id::text) AS ga4_customer_id,
    h.website_platform,
    'scrap'::text AS inventory_source,
    v.scrap_link,
    v.website_url,
    v.cms,
    v.vdp_logic,
    v.srp_logic,
    v.home_page_logic,
    v.data_source
  FROM public.smart_hoot_config h
  LEFT JOIN LATERAL (
    SELECT vl.*
    FROM public.smart_vdp_logic vl
    WHERE trim(vl.dealer_id::text) = trim(h.ga4_customer_id::text)
       OR vl.dealer_name = h.customer_name
    ORDER BY vl.id DESC
    LIMIT 1
  ) v ON TRUE
  WHERE h.is_active IS TRUE
    AND h.ga4_customer_id IS NOT NULL
    AND trim(h.ga4_customer_id::text) <> ''
    AND v.scrap_link IS NOT NULL
    AND trim(v.scrap_link) <> ''
    AND (p_client_id IS NULL OR trim(h.ga4_customer_id::text) = trim(p_client_id))
  ORDER BY h.customer_name;
$$;

REVOKE ALL ON FUNCTION public.get_scrap_dealers_for_sync(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_scrap_dealers_for_sync(text)
  TO service_role;
