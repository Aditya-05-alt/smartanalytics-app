-- Admin → Vdp - Logics tab. Single query (indexed filters) instead of paginated REST.
-- Run in Supabase SQL editor after smart_vdp_logic table exists.

CREATE OR REPLACE FUNCTION public.build_vdp_logics(
  p_dealer_name   text DEFAULT NULL,
  p_cms           text DEFAULT NULL,
  p_data_source   text DEFAULT NULL,
  p_search        text DEFAULT NULL
)
RETURNS TABLE (
  id                 integer,
  dealer_name        text,
  dealer_id          text,
  website_url        text,
  cms                text,
  data_source        text,
  hoot_link          text,
  scrap_link         text,
  vdp_logic          text,
  srp_logic          text,
  home_page_logic    text,
  others             text,
  created_at         timestamptz,
  updated_at         timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    v.id,
    v.dealer_name,
    v.dealer_id,
    v.website_url,
    v.cms,
    v.data_source,
    v.hoot_link,
    v.scrap_link,
    v.vdp_logic,
    v.srp_logic,
    v.home_page_logic,
    v.others,
    v.created_at,
    v.updated_at
  FROM public.smart_vdp_logic v
  WHERE (p_dealer_name IS NULL OR trim(p_dealer_name) = '' OR v.dealer_name ILIKE '%' || trim(p_dealer_name) || '%')
    AND (p_cms IS NULL OR trim(p_cms) = '' OR v.cms = trim(p_cms))
    AND (p_data_source IS NULL OR trim(p_data_source) = '' OR v.data_source = trim(p_data_source))
    AND (
      p_search IS NULL
      OR trim(p_search) = ''
      OR v.dealer_name ILIKE '%' || trim(p_search) || '%'
      OR v.dealer_id ILIKE '%' || trim(p_search) || '%'
      OR v.website_url ILIKE '%' || trim(p_search) || '%'
      OR v.cms ILIKE '%' || trim(p_search) || '%'
      OR v.data_source ILIKE '%' || trim(p_search) || '%'
      OR v.vdp_logic ILIKE '%' || trim(p_search) || '%'
      OR v.srp_logic ILIKE '%' || trim(p_search) || '%'
      OR v.home_page_logic ILIKE '%' || trim(p_search) || '%'
      OR v.others ILIKE '%' || trim(p_search) || '%'
    )
  ORDER BY v.dealer_name ASC NULLS LAST, v.id ASC;
$$;

GRANT EXECUTE ON FUNCTION public.build_vdp_logics(text, text, text, text)
  TO anon, authenticated, service_role;
