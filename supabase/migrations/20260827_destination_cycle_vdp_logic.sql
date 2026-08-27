-- Destination Cycle: GA4 page_path uses SEO URLs, not default.asp?query strings.
-- Covers: default.asp query VDP, New/Pre-owned SEO slugs, inventory/v1 unit pages.

UPDATE public.smart_vdp_logic
SET
  vdp_logic = '/default\.asp\?page=x(?:New|PreOwned)InventoryDetail&id=\d+&p=\d+&s=[^&]+&d=[^&]+(?:&t=[^&]+)?&fr=x(?:New|PreOwned)Inventory|/(?:New|Pre-?[Oo]wned)-Inventory-[A-Za-z0-9-]+-\d+|/inventory/v1/Current/.+---\d+',
  updated_at = now()
WHERE dealer_id = '1421445735'
   OR ga4_property_id = '483810815';

UPDATE public.smart_hoot_config
SET ga4_property_id = '483810815'
WHERE ga4_customer_id = '1421445735'
  AND ga4_property_id IS NULL;
