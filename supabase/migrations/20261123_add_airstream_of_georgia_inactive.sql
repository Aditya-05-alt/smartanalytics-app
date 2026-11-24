-- Airstream of Georgia — registered inactive (no sync until activated).
-- Customer id: 8824163456 · Property id: 561388508
-- Website: https://www.airstreamofgeorgia.com/

insert into public.smart_ga4_config (
  client_id,
  ga4_property_id,
  account_name,
  is_active,
  sync_status
)
select
  '8824163456',
  '561388508',
  'Airstream of Georgia',
  false,
  'Waiting'
where not exists (
  select 1 from public.smart_ga4_config
  where client_id = '8824163456' and ga4_property_id = '561388508'
);

insert into public.smart_hoot_config (
  customer_name,
  hoot_url,
  ga4_customer_id,
  ga4_property_id,
  dealer_category,
  is_active
)
select
  'Airstream of Georgia',
  'https://www.airstreamofgeorgia.com/',
  '8824163456',
  '561388508',
  'RV',
  false
where not exists (
  select 1 from public.smart_hoot_config
  where ga4_customer_id::text = '8824163456'
);
