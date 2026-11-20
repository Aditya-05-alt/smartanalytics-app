/**
 * One-off: pull A&L Google Ads campaign days into wheeler_reports_ad_stats.
 * Uses credentials from ../google-ads-campaign-sync/.env
 * Range: 2026-10-01 .. 2026-11-26
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const parts = (name) => name.split('|').map((p) => p.trim()).filter(Boolean);
function channelFor(name, apiChannel) {
  const map = {
    SEARCH: 'Search', PERFORMANCE_MAX: 'Performance Max', DISPLAY: 'Display', VIDEO: 'Video',
    SHOPPING: 'Shopping', DEMAND_GEN: 'Demand Gen', DISCOVERY: 'Demand Gen', LOCAL: 'Local',
    SMART: 'Smart', HOTEL: 'Hotel', MULTI_CHANNEL: 'App',
  };
  if (apiChannel && map[apiChannel]) return map[apiChannel];
  const kind = (parts(name)[1] || '').toUpperCase();
  if (kind === 'SEARCH') return 'Search';
  if (kind === 'PMAX' || kind === 'VLA') return 'Performance Max';
  if (kind === 'DISPLAY') return 'Display';
  if (kind === 'VIDEO' || kind === 'YOUTUBE') return 'Video';
  return apiChannel
    ? apiChannel.charAt(0) + apiChannel.slice(1).toLowerCase().replace(/_/g, ' ')
    : 'Other';
}
function googleGroupFor(name, channel) {
  const p = parts(name);
  const kind = (p[1] || '').toUpperCase();
  if (kind === 'SEARCH' && p[2]) return 'Search | ' + (p[2].startsWith('Manufacturer') ? 'Manufacturer' : p[2]);
  if (kind === 'PMAX') return 'PMax | ' + (/get direction/i.test(name) ? 'Get Directions' : p[2] || 'Other');
  if (kind === 'VLA') return 'VLA';
  if (kind === 'DISPLAY') return 'Display';
  return channel || 'Other';
}
function storeForCampaign(name, stores) {
  const low = name.toLowerCase();
  if (low.includes('all locations')) return null;
  for (const s of [...stores].sort((a, b) => a.sort - b.sort)) {
    if ((s.campaign_terms || []).some((t) => t && low.includes(String(t).toLowerCase()))) return s.id;
  }
  return null;
}

const ROOT = path.resolve('c:/htmls/Smart_analytics_Main');
const ADS_ENV = path.join(ROOT, 'google-ads-campaign-sync/.env');
const APP_ENV = path.join(ROOT, 'smartanalytics-app/.env.local');
const CUSTOMER_ID = '2728830488';
const FROM = '2026-10-01';
const TO = '2026-11-26';

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

const ads = loadEnv(ADS_ENV);
const app = loadEnv(APP_ENV);

const developerToken = ads.GOOGLE_DEVELOPER_TOKEN;
const clientId = ads.GOOGLE_CLIENT_ID;
const clientSecret = ads.GOOGLE_CLIENT_SECRET;
const refreshToken = ads.GOOGLE_REFRESH_TOKEN;
const loginCustomerId = (ads.GOOGLE_LOGIN_CUSTOMER_ID || '').replace(/-/g, '');
const apiVersion = ads.GOOGLE_ADS_API_VERSION || 'v21';
const supabaseUrl = app.NEXT_PUBLIC_SUPABASE_URL || ads.SUPABASE_URL;
const serviceKey = app.SUPABASE_SERVICE_ROLE_KEY || ads.SUPABASE_SERVICE_ROLE_KEY;

if (!developerToken || !clientId || !clientSecret || !refreshToken) {
  console.error('Missing Google Ads credentials in google-ads-campaign-sync/.env');
  process.exit(1);
}
if (!supabaseUrl || !serviceKey) {
  console.error('Missing Supabase service credentials');
  process.exit(1);
}

const sb = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function accessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });
  const body = await res.json();
  if (!res.ok || !body.access_token) {
    throw new Error(`OAuth failed: ${body.error_description || body.error || res.status}`);
  }
  return body.access_token;
}

async function fetchDaily(from, to) {
  const query = `
    SELECT campaign.id, campaign.name, campaign.advertising_channel_type, segments.date,
           metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.search_impression_share
    FROM campaign
    WHERE segments.date BETWEEN '${from}' AND '${to}' AND metrics.impressions > 0`;
  const headers = {
    authorization: `Bearer ${await accessToken()}`,
    'developer-token': developerToken,
    'content-type': 'application/json',
  };
  if (loginCustomerId) headers['login-customer-id'] = loginCustomerId;

  const url = `https://googleads.googleapis.com/${apiVersion}/customers/${CUSTOMER_ID}/googleAds:searchStream`;
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ query }) });
  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 800);
    try {
      const j = JSON.parse(text);
      msg = JSON.stringify(j[0]?.error ?? j.error ?? j).slice(0, 800);
    } catch {
      /* keep */
    }
    throw new Error(`Google Ads API ${res.status}: ${msg}`);
  }
  const batches = JSON.parse(text);
  const rows = [];
  for (const b of batches) for (const r of b.results ?? []) rows.push(r);
  return rows;
}

async function main() {
  const { data: client, error: cErr } = await sb
    .from('wheeler_reports_clients')
    .update({ google_ads_customer_id: CUSTOMER_ID })
    .eq('slug', 'al-rv-sales')
    .select('id, slug, name')
    .single();
  if (cErr) throw cErr;

  const { data: stores, error: sErr } = await sb
    .from('wheeler_reports_stores')
    .select('id, name, sort, campaign_terms')
    .eq('client_id', client.id)
    .order('sort');
  if (sErr) throw sErr;

  console.log(`Client ${client.name} (${client.id}) · ${stores.length} stores · ${FROM}..${TO}`);
  console.log('Fetching Google Ads…');
  const apiRows = await fetchDaily(FROM, TO);
  console.log(`API rows: ${apiRows.length}`);

  const stats = apiRows.map((r) => {
    const name = r.campaign.name;
    const channel = channelFor(name, r.campaign.advertisingChannelType);
    return {
      client_id: client.id,
      platform: 'google',
      date_from: r.segments.date,
      date_to: r.segments.date,
      campaign_id: String(r.campaign.id),
      campaign_name: name,
      channel,
      campaign_group: googleGroupFor(name, channel),
      store_id: storeForCampaign(name, stores),
      cost: Math.round(Number(r.metrics.costMicros ?? 0) / 10_000) / 100,
      impressions: Number(r.metrics.impressions ?? 0),
      clicks: Number(r.metrics.clicks ?? 0),
      search_impression_share: r.metrics.searchImpressionShare ?? null,
      platform_leads: null,
      source: 'api',
      updated_at: new Date().toISOString(),
    };
  });

  // Replace overlapping google rows for the range
  const { error: delErr } = await sb
    .from('wheeler_reports_ad_stats')
    .delete()
    .eq('client_id', client.id)
    .eq('platform', 'google')
    .gte('date_from', FROM)
    .lte('date_to', TO);
  if (delErr) throw delErr;

  const CHUNK = 500;
  for (let i = 0; i < stats.length; i += CHUNK) {
    const slice = stats.slice(i, i + CHUNK);
    const { error } = await sb.from('wheeler_reports_ad_stats').upsert(slice, {
      onConflict: 'client_id,platform,campaign_id,date_from,date_to',
    });
    if (error) throw error;
    console.log(`Upserted ${Math.min(i + CHUNK, stats.length)} / ${stats.length}`);
  }

  const assigned = stats.filter((s) => s.store_id).length;
  const cost = stats.reduce((a, s) => a + s.cost, 0);
  console.log(
    JSON.stringify(
      {
        ok: true,
        rows: stats.length,
        assigned_to_store: assigned,
        shared: stats.length - assigned,
        total_cost: Math.round(cost * 100) / 100,
        from: FROM,
        to: TO,
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
