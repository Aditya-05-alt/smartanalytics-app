-- Sky River RV: stores from smart_conner_inventory locations + Google Ads customer id.
-- October Google Ads rows are loaded via scripts/setup-wheeler-reports-sky-river-october.mjs (no Meta).

insert into public.wheeler_reports_clients (slug, name, timezone, google_ads_customer_id)
values ('sky-river-rv', 'Sky River RV', 'America/Los_Angeles', '9842851162')
on conflict (slug) do update set
  name = excluded.name,
  timezone = excluded.timezone,
  google_ads_customer_id = excluded.google_ads_customer_id;

with c as (select id from public.wheeler_reports_clients where slug = 'sky-river-rv')
insert into public.wheeler_reports_stores (client_id, name, sort, campaign_terms, lead_locations)
select c.id, s.name, s.sort, s.terms, s.locs from c, (values
  ('Fresno, CA',       1, array['fresno'],                              array['Fresno']),
  ('Paso Robles, CA',  2, array['paso robles', 'paso_robles', 'paso'],  array['Paso Robles']),
  ('Pismo Beach, CA',  3, array['pismo beach', 'pismo', 'pismo_beach'], array['Pismo Beach']),
  ('Santa Maria, CA',  4, array['santa maria', 'santa_maria'],          array['Santa Maria'])
) as s(name, sort, terms, locs)
on conflict (client_id, name) do update set
  sort = excluded.sort,
  campaign_terms = excluded.campaign_terms,
  lead_locations = excluded.lead_locations;
