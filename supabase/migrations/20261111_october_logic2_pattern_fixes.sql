-- October 2026 unmapped-URL fix: logic 2 patterns that missed real VDP URLs.

UPDATE public.smart_vdp_logic_2
SET vdp_logic = vdp_logic || ' OR ^/product/(new|used)-\d{4}-.+', updated_at = now()
WHERE dealer_id = '6999622645' AND vdp_logic NOT LIKE '%^/product/%';

UPDATE public.smart_vdp_logic_2
SET vdp_logic = vdp_logic || ' OR ^/inventory/[^/]+/\d{4}-[^/]+/?$', updated_at = now()
WHERE dealer_id = '8182570850' AND vdp_logic NOT LIKE '%[^/]+/\d{4}-[^/]+/?$%';

UPDATE public.smart_vdp_logic_2
SET vdp_logic = vdp_logic || ' OR ^/inventory/(new|used)/[a-z0-9+-]+-(19|20)\d{2}-.+', updated_at = now()
WHERE dealer_id = '8182570850' AND vdp_logic NOT LIKE '%(new|used)/[a-z0-9+-]+-%';

UPDATE public.smart_vdp_logic_2
SET vdp_logic = vdp_logic || ' OR ^/inventory/v1/\d{4}/[^/]+/.+---\d+', updated_at = now()
WHERE dealer_id = '2721177227' AND vdp_logic NOT LIKE '%/inventory/v1/%';

-- Dealers with a logic 1 VDP pattern but no logic 2 pattern: copy it across.
-- Redline's logic 1 also carries a broad `[?&]page=` rule that would flag SRP
-- pagination as VDPs, so it is left out here.
UPDATE public.smart_vdp_logic_2 l2
SET vdp_logic = l1.vdp_logic, updated_at = now()
FROM public.smart_vdp_logic l1
WHERE l1.dealer_id::text = l2.dealer_id
  AND l2.dealer_id IN ('5913501491', '8155900509', '4662386311', '4847086431')
  AND NULLIF(btrim(l2.vdp_logic), '') IS NULL;

INSERT INTO public.smart_vdp_logic_2 (
  dealer_name, dealer_id, website_url, cms, data_source, hoot_link, scrap_link,
  vdp_logic, srp_logic, home_page_logic, others, ga4_property_id
)
SELECT
  l1.dealer_name, l1.dealer_id::text, l1.website_url, l1.cms, l1.data_source, l1.hoot_link, l1.scrap_link,
  CASE
    WHEN l1.dealer_id::text IN ('7084352568', '5712913774', '2505143058', '4568026047')
    THEN '^/(new|used|pre-?owned)-inventory-.+-\d+(\?.*)?$ OR ^/--xInventoryDetail OR ^/inventory/v1/Current/.+---\d+'
    ELSE l1.vdp_logic
  END,
  l1.srp_logic, l1.home_page_logic, l1.others, l1.ga4_property_id
FROM public.smart_vdp_logic l1
WHERE l1.dealer_id::text IN (
    '7084352568', '5712913774', '2505143058', '4568026047',
    '1275929107', '3894496296', '2961835070', '8097135390', '5407023162'
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.smart_vdp_logic_2 x WHERE x.dealer_id = l1.dealer_id::text
  );
