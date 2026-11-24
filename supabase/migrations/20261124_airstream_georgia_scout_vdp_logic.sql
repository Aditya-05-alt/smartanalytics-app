-- Airstream of Georgia — Scout RV VDP URL patterns for Admin mapping
-- Sample paths: /inventory/new/travel-trailer-2026-airstream-...
--               /inventory/used/2022-airstream-flying-cloud-...

INSERT INTO public.smart_vdp_logic (
  dealer_name,
  dealer_id,
  website_url,
  cms,
  data_source,
  hoot_link,
  scrap_link,
  vdp_logic,
  srp_logic,
  home_page_logic,
  ga4_property_id,
  updated_at
)
SELECT
  'Airstream of Georgia',
  '8824163456',
  'https://www.airstreamofgeorgia.com/',
  'Scout RV',
  'Conner',
  NULL,
  'off',
  $pat$^/(inventory)/(new|used)[/ \-]+.*(\d{4}) OR ^/product/(new|used)-(\d{4})$pat$,
  $pat$^/(inventory|product|new-rvs|used-rvs|rv-search|boat-search|showroom|locations)$pat$,
  '^/$',
  '561388508',
  now()
WHERE NOT EXISTS (
  SELECT 1 FROM public.smart_vdp_logic
  WHERE dealer_id::text = '8824163456'
);

UPDATE public.smart_vdp_logic
SET
  dealer_name = 'Airstream of Georgia',
  website_url = 'https://www.airstreamofgeorgia.com/',
  cms = 'Scout RV',
  data_source = 'Conner',
  scrap_link = COALESCE(NULLIF(scrap_link, ''), 'off'),
  vdp_logic = $pat$^/(inventory)/(new|used)[/ \-]+.*(\d{4}) OR ^/product/(new|used)-(\d{4})$pat$,
  srp_logic = $pat$^/(inventory|product|new-rvs|used-rvs|rv-search|boat-search|showroom|locations)$pat$,
  home_page_logic = COALESCE(home_page_logic, '^/$'),
  ga4_property_id = '561388508',
  updated_at = now()
WHERE dealer_id::text = '8824163456';

INSERT INTO public.smart_vdp_logic_2 (
  dealer_name,
  dealer_id,
  website_url,
  cms,
  data_source,
  hoot_link,
  scrap_link,
  vdp_logic,
  srp_logic,
  home_page_logic,
  ga4_property_id,
  updated_at
)
SELECT
  'Airstream of Georgia',
  '8824163456',
  'https://www.airstreamofgeorgia.com/',
  'Scout RV',
  'Conner',
  NULL,
  'off',
  $pat$^/(inventory)/(new|used)[/ \-]+.*(\d{4}) OR ^/product/(new|used)-(\d{4})$pat$,
  $pat$^/(inventory|product|new-rvs|used-rvs|rv-search|boat-search|showroom|locations)$pat$,
  '^/$',
  '561388508',
  now()
WHERE NOT EXISTS (
  SELECT 1 FROM public.smart_vdp_logic_2
  WHERE dealer_id = '8824163456'
);

UPDATE public.smart_vdp_logic_2
SET
  dealer_name = 'Airstream of Georgia',
  website_url = 'https://www.airstreamofgeorgia.com/',
  cms = 'Scout RV',
  data_source = 'Conner',
  scrap_link = COALESCE(NULLIF(scrap_link, ''), 'off'),
  vdp_logic = $pat$^/(inventory)/(new|used)[/ \-]+.*(\d{4}) OR ^/product/(new|used)-(\d{4})$pat$,
  srp_logic = $pat$^/(inventory|product|new-rvs|used-rvs|rv-search|boat-search|showroom|locations)$pat$,
  home_page_logic = COALESCE(home_page_logic, '^/$'),
  ga4_property_id = '561388508',
  updated_at = now()
WHERE dealer_id = '8824163456';
