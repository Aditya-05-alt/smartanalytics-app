-- Destination Cycle (1421445735): GA4 page_path uses SEO slugs + inventory/v1 paths.
-- Hoot inventory uses default.asp?id= — matched in Step 3 via extract_dealer_spike_listing_id_from_page_path.
-- VDP logic field supports multiple patterns separated by ` OR ` (Admin → VDP Logics).

UPDATE public.smart_vdp_logic
SET
  vdp_logic = '/(?:New|Pre-?owned)-Inventory-.+-\d+ OR /inventory/v1/Current/.+---\d+',
  updated_at = now()
WHERE dealer_id = '1421445735'
   OR ga4_property_id = '483810815';

UPDATE public.smart_hoot_config
SET ga4_property_id = '483810815'
WHERE ga4_customer_id = '1421445735'
  AND ga4_property_id IS NULL;
