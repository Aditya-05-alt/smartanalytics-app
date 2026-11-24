-- Airstream of Georgia → Scout RV Conner feed + GA4 sync group
-- Feed: https://www.airstreamofgeorgia.com/api/feeds/vla
-- client_id 8824163456 · property 561388508
-- Inventory load: invoke smart-conner-inventory-sync with client_id (no Step 2/3 mapping).

INSERT INTO public.smart_conner_config (
  customer_name,
  hoot_id,
  wheeler_url,
  is_active,
  ga4_customer_id,
  website_platform,
  dealer_category,
  ga4_property_id,
  updated_at
)
SELECT
  'Airstream of Georgia',
  NULL,
  'https://www.airstreamofgeorgia.com/api/feeds/vla',
  true,
  '8824163456',
  'Scout RV',
  'RV',
  '561388508',
  now()
WHERE NOT EXISTS (
  SELECT 1 FROM public.smart_conner_config
  WHERE ga4_customer_id = '8824163456'
);

UPDATE public.smart_conner_config
SET
  customer_name = 'Airstream of Georgia',
  wheeler_url = 'https://www.airstreamofgeorgia.com/api/feeds/vla',
  is_active = true,
  website_platform = 'Scout RV',
  dealer_category = COALESCE(dealer_category, 'RV'),
  ga4_property_id = '561388508',
  updated_at = now()
WHERE ga4_customer_id = '8824163456';

UPDATE public.smart_ga4_config
SET
  is_active = true,
  sync_group = 40,
  account_name = 'Airstream of Georgia',
  sync_status = COALESCE(NULLIF(sync_status, ''), 'Waiting')
WHERE client_id = '8824163456'
  AND ga4_property_id = '561388508';

UPDATE public.smart_hoot_config
SET
  customer_name = 'Airstream of Georgia',
  is_active = true,
  dealer_category = 'RV',
  website_platform = 'Scout RV',
  ga4_property_id = '561388508',
  hoot_url = 'https://www.airstreamofgeorgia.com/'
WHERE ga4_customer_id::text = '8824163456';
