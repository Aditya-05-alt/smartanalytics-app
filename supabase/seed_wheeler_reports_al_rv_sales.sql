-- A&L RV Sales: first client, its 8 stores, and the October 2026 figures that were
-- entered by hand on the old dashboard (media spend, Facebook spend, other costs).
-- Run after 0001_init.sql. Leads and Google Ads come in through the Data page
-- (upload the October and November lead exports and Google Ads reports there) or the API sync.

with c as (
  insert into public.wheeler_reports_clients (slug, name, timezone)
  values ('al-rv-sales', 'A&L RV Sales', 'America/New_York')
  on conflict (slug) do update set name = excluded.name
  returning id
)
insert into public.wheeler_reports_stores (client_id, name, sort, campaign_terms, lead_locations)
select c.id, s.name, s.sort, s.terms, s.locs from c, (values
  ('Jackson, TN',                   1, array['jackson'],                               array['Jackson']),
  ('Columbia, TN',                  2, array['columbia'],                              array['Columbia']),
  ('Christiana / Murfreesboro, TN', 3, array['murfreesboro', 'christiana'],            array['Murfreesboro', 'Christiana']),
  ('Sevierville, TN',               4, array['sevierville'],                           array['Sevierville']),
  ('Johnson City, TN',              5, array['johnson city', 'johnson_city', 'kodak'], array['Johnson City']),
  ('Richmond, VA',                  6, array['richmond', 'state va'],                  array['Richmond']),
  ('Lake Park, GA',                 7, array['lake park', 'lake_park', 'state ga'],    array['Lake Park']),
  ('Greenville / Chocowinity, NC',  8, array['greenville', 'chocowinity', 'state nc'], array['Greenville', 'Chocowinity'])
) as s(name, sort, terms, locs)
on conflict (client_id, name) do update set sort = excluded.sort, campaign_terms = excluded.campaign_terms, lead_locations = excluded.lead_locations;

-- October 2026 total media spend per store
insert into public.wheeler_reports_media_spend (client_id, store_id, month, amount)
select st.client_id, st.id, date '2026-10-01', v.amount
from (values
  ('Christiana / Murfreesboro, TN', 8791.30), ('Columbia, TN', 4835.96), ('Greenville / Chocowinity, NC', 5533.57),
  ('Jackson, TN', 5983.64), ('Johnson City, TN', 6382.75), ('Lake Park, GA', 6645.65),
  ('Richmond, VA', 6886.45), ('Sevierville, TN', 4981.09)
) as v(store, amount)
join public.wheeler_reports_stores st on st.name = v.store
join public.wheeler_reports_clients cl on cl.id = st.client_id and cl.slug = 'al-rv-sales'
on conflict (client_id, store_id, month) do update set amount = excluded.amount;

-- October 2026 Meta campaigns (migration/demo mapping: spend + platform leads by store)
insert into public.wheeler_reports_ad_stats (
  client_id, platform, date_from, date_to, campaign_id, campaign_name, channel, campaign_group,
  store_id, cost, impressions, clicks, platform_leads, source
)
select st.client_id, 'meta', date '2026-10-01', date '2026-10-31',
  v.campaign_id, v.campaign_name, 'Facebook', 'Meta', st.id,
  v.cost, v.impressions, v.clicks, v.platform_leads, 'manual'
from (values
  ('Jackson, TN',                   '120001', 'FB | Jackson | Price Unlock',       1297.07,  84000, 2100, 48),
  ('Columbia, TN',                  '120002', 'FB | Columbia | Inventory',         1128.78,  72000, 1800, 36),
  ('Christiana / Murfreesboro, TN', '120003', 'FB | Murfreesboro | Price Unlock',  1871.97, 110000, 2650, 62),
  ('Sevierville, TN',               '120004', 'FB | Sevierville | Leads',          1162.77,  69000, 1550, 31),
  ('Johnson City, TN',              '120005', 'FB | Johnson City | Price Unlock',  1446.08,  91000, 1980, 44),
  ('Richmond, VA',                  '120006', 'FB | Richmond | Inventory',         1268.28,  78000, 1720, 39),
  ('Lake Park, GA',                 '120007', 'FB | Lake Park | Price Unlock',     1306.33,  82000, 1880, 41),
  ('Greenville / Chocowinity, NC',  '120008', 'FB | Greenville | Leads',           1160.95,  70000, 1600, 33)
) as v(store, campaign_id, campaign_name, cost, impressions, clicks, platform_leads)
join public.wheeler_reports_stores st on st.name = v.store
join public.wheeler_reports_clients cl on cl.id = st.client_id and cl.slug = 'al-rv-sales'
on conflict (client_id, platform, campaign_id, date_from, date_to) do update set
  campaign_name = excluded.campaign_name,
  channel = excluded.channel,
  campaign_group = excluded.campaign_group,
  store_id = excluded.store_id,
  cost = excluded.cost,
  impressions = excluded.impressions,
  clicks = excluded.clicks,
  platform_leads = excluded.platform_leads,
  source = excluded.source;

-- Other costs entered by the client for October 2026
insert into public.wheeler_reports_other_costs (client_id, store_id, month, head, amount, created_at)
select st.client_id, st.id, date '2026-10-01', v.head, v.amount, v.created_at::timestamptz
from (values
  ('Christiana / Murfreesboro, TN', 'All Other Wheeler Fees', 2722.50, '2026-11-05T21:29:59.355Z'),
  ('Columbia, TN',                  'All Other Wheeler Fees', 1922.50, '2026-11-05T21:30:11.011Z'),
  ('Greenville / Chocowinity, NC',  'All Other Wheeler Fees', 1922.50, '2026-11-05T21:30:21.631Z'),
  ('Johnson City, TN',              'All Other Wheeler Fees', 1922.50, '2026-11-05T21:30:51.914Z'),
  ('Lake Park, GA',                 'All Other Wheeler Fees', 1922.50, '2026-11-05T21:31:03.315Z'),
  ('Richmond, VA',                  'All Other Wheeler Fees', 1922.50, '2026-11-05T21:31:16.203Z'),
  ('Sevierville, TN',               'All Other Wheeler Fees', 1922.50, '2026-11-05T21:31:27.271Z'),
  ('Jackson, TN',                   'All Other Wheeler Fees', 1922.50, '2026-11-05T21:37:16.667Z'),
  ('Richmond, VA',                  'Streaming Video',        1700.00, '2026-11-06T16:51:59.742Z'),
  ('Columbia, TN',                  'Billboard',               500.00, '2026-11-12T19:22:13.661Z')
) as v(store, head, amount, created_at)
join public.wheeler_reports_stores st on st.name = v.store
join public.wheeler_reports_clients cl on cl.id = st.client_id and cl.slug = 'al-rv-sales';
