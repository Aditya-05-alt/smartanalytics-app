/**
 * Align A&L Meta ads + Facebook website leads with the Wheeler Reports migration/demo mapping.
 * No API calls — data + store/campaign mapping only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const ROOT = path.resolve('c:/htmls/Smart_analytics_Main/smartanalytics-app');
const FROM = '2026-10-01';
const TO = '2026-10-31';

function loadEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = loadEnv(path.join(ROOT, '.env.local'));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const META = [
  { store: 'Jackson, TN', id: '120001', name: 'FB | Jackson | Price Unlock', cost: 1297.07, impressions: 84000, clicks: 2100, platform_leads: 48 },
  { store: 'Columbia, TN', id: '120002', name: 'FB | Columbia | Inventory', cost: 1128.78, impressions: 72000, clicks: 1800, platform_leads: 36 },
  { store: 'Christiana / Murfreesboro, TN', id: '120003', name: 'FB | Murfreesboro | Price Unlock', cost: 1871.97, impressions: 110000, clicks: 2650, platform_leads: 62 },
  { store: 'Sevierville, TN', id: '120004', name: 'FB | Sevierville | Leads', cost: 1162.77, impressions: 69000, clicks: 1550, platform_leads: 31 },
  { store: 'Johnson City, TN', id: '120005', name: 'FB | Johnson City | Price Unlock', cost: 1446.08, impressions: 91000, clicks: 1980, platform_leads: 44 },
  { store: 'Richmond, VA', id: '120006', name: 'FB | Richmond | Inventory', cost: 1268.28, impressions: 78000, clicks: 1720, platform_leads: 39 },
  { store: 'Lake Park, GA', id: '120007', name: 'FB | Lake Park | Price Unlock', cost: 1306.33, impressions: 82000, clicks: 1880, platform_leads: 41 },
  { store: 'Greenville / Chocowinity, NC', id: '120008', name: 'FB | Greenville | Leads', cost: 1160.95, impressions: 70000, clicks: 1600, platform_leads: 33 },
];

function day(i) {
  const d = (i % 31) + 1;
  return `2026-10-${String(d).padStart(2, '0')}`;
}

async function main() {
  const { data: client, error: cErr } = await sb
    .from('wheeler_reports_clients')
    .select('id')
    .eq('slug', 'al-rv-sales')
    .single();
  if (cErr) throw cErr;

  const { data: stores, error: sErr } = await sb
    .from('wheeler_reports_stores')
    .select('id, name')
    .eq('client_id', client.id);
  if (sErr) throw sErr;
  const storeByName = new Map(stores.map((s) => [s.name, s.id]));

  // Replace Meta ads with migration campaign rows
  await sb.from('wheeler_reports_ad_stats').delete().eq('client_id', client.id).eq('platform', 'meta');

  const ads = META.map((m) => {
    const store_id = storeByName.get(m.store);
    if (!store_id) throw new Error(`Missing store ${m.store}`);
    return {
      client_id: client.id,
      platform: 'meta',
      date_from: FROM,
      date_to: TO,
      campaign_id: m.id,
      campaign_name: m.name,
      channel: 'Facebook',
      campaign_group: 'Meta',
      store_id,
      cost: m.cost,
      impressions: m.impressions,
      clicks: m.clicks,
      platform_leads: m.platform_leads,
      source: 'manual',
      updated_at: new Date().toISOString(),
    };
  });
  const { error: aErr } = await sb.from('wheeler_reports_ad_stats').insert(ads);
  if (aErr) throw aErr;
  console.log(`Meta campaigns: ${ads.length}`);

  // Replace Facebook website leads with store + campaign mapped migration leads
  const { data: oldFb, error: oErr } = await sb
    .from('wheeler_reports_leads')
    .select('id')
    .eq('client_id', client.id)
    .ilike('source', 'facebook%');
  if (oErr) throw oErr;
  if (oldFb?.length) {
    for (let i = 0; i < oldFb.length; i += 500) {
      const { error } = await sb
        .from('wheeler_reports_leads')
        .delete()
        .in(
          'id',
          oldFb.slice(i, i + 500).map((r) => r.id),
        );
      if (error) throw error;
    }
    console.log(`Removed old Facebook leads: ${oldFb.length}`);
  }

  const leads = [];
  let seq = 0;
  for (const m of META) {
    const store_id = storeByName.get(m.store);
    const count = Math.round(m.platform_leads * 0.7);
    for (let i = 0; i < count; i++) {
      seq += 1;
      const financing = i % 4 === 0;
      leads.push({
        client_id: client.id,
        store_id,
        external_id: `meta-seed|${m.id}|${seq}`,
        lead_date: day(i + 3),
        created_at_utc: `${day(i + 3)}T15:00:00.000Z`,
        source: 'facebook',
        medium: 'cpc',
        campaign: m.id,
        lead_type: financing ? 'financing' : 'unlock_price',
        form: financing ? 'Payment Calculator' : 'Price Unlock',
        person_hash: null,
        imported_at: new Date().toISOString(),
      });
    }
  }

  for (let i = 0; i < leads.length; i += 500) {
    const { error } = await sb.from('wheeler_reports_leads').insert(leads.slice(i, i + 500));
    if (error) throw error;
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        meta_campaigns: ads.length,
        facebook_leads: leads.length,
        platform_leads_total: META.reduce((a, m) => a + m.platform_leads, 0),
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
