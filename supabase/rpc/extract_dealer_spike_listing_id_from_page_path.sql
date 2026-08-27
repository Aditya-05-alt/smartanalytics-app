-- Dealer Spike: GA4 page_path is often an SEO slug while Hoot inventory URLs use id= query params.
-- Examples:
--   /New-Inventory-2026-Can-Am-...-Destination-Cycle-18913034  -> id=18913034
--   /default.asp?page=xNewInventoryDetail&id=18913034&...         -> id=18913034
--   /inventory/v1/Current/...---25638851                          -> id=25638851 (if present in URL)

CREATE OR REPLACE FUNCTION public.extract_dealer_spike_listing_id_from_page_path(
  p_page_path text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (regexp_match(p_page_path, '[?&]id=(\d+)', 'i'))[1],
    (regexp_match(p_page_path, '---(\d+)$'))[1],
    CASE
      WHEN p_page_path ~* '/(?:New|Pre-?Owned)-Inventory-'
        THEN (regexp_match(p_page_path, '-(\d+)$'))[1]
      ELSE NULL
    END
  );
$$;

GRANT EXECUTE ON FUNCTION public.extract_dealer_spike_listing_id_from_page_path(text)
  TO anon, authenticated, service_role;
