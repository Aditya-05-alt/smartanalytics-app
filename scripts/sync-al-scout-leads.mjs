/**
 * One-off / CLI: sync Scout RV website leads into Wheeler Reports for A&L.
 * Usage: node scripts/sync-al-scout-leads.mjs [from] [to]
 * Defaults: 2026-11-01 .. today (UTC date).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const ROOT = path.resolve('c:/htmls/Smart_analytics_Main/smartanalytics-app');
const FROM = process.argv[2] || '2026-11-01';
const TO = process.argv[3] || new Date().toISOString().slice(0, 10);

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

const env = { ...loadEnv(path.join(ROOT, '.env.local')), ...process.env };
const key = env.SCOUT_RV_API_KEY;
const base = (env.SCOUT_RV_LEADS_URL || 'https://www.scout-rv.com/api/content-api/v1/leads').replace(/\?.*$/, '');
if (!key) throw new Error('Missing SCOUT_RV_API_KEY');
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing Supabase env');

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function dateInZone(instant, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

async function fetchAll() {
  const all = [];
  let offset = 0;
  let total = 0;
  for (;;) {
    const url = new URL(base);
    url.searchParams.set('tenant', 'al-rv-sales');
    url.searchParams.set('from', FROM);
    url.searchParams.set('to', TO);
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('limit', '250');
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Scout ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = await res.json();
    const data = json.data || {};
    total = data.total ?? total;
    const batch = data.leads || [];
    all.push(...batch);
    console.log(`fetched ${batch.length} (offset ${offset}, total ${total})`);
    if (!data.has_more || !batch.length) break;
    offset = data.next_offset != null ? data.next_offset : offset + batch.length;
  }
  return { leads: all, total };
}

function mapLead(lead, byLocation, timeZone) {
  const id = (lead.id || '').trim();
  const t = lead.created_at ? new Date(lead.created_at) : null;
  if (!id || !t || Number.isNaN(t.getTime())) return null;
  const date = dateInZone(t, timeZone);
  if (date < FROM || date > TO) return null;

  const keys = [lead.store?.name, lead.store?.city].map((x) => (x || '').trim().toLowerCase()).filter(Boolean);
  let storeId = null;
  for (const k of keys) {
    storeId = byLocation.get(k) || null;
    if (storeId) break;
  }

  const attr = lead.attribution || {};
  const sess = lead.session || {};
  let source = (attr.utm_source || attr.lead_source || attr.source || sess.utm_source || '').trim();
  let medium = (attr.utm_medium || sess.utm_medium || '').trim();
  if (!source || source.toLowerCase() === 'direct') {
    source = '(direct)';
    medium = '(none)';
  }
  if (/^facebook/i.test(source)) source = 'facebook';
  medium = medium || '(none)';

  let campaign = (attr.utm_campaign || sess.utm_campaign || '').trim();
  const detail = String(attr.lead_source_detail || '').split('/');
  const s = source.toLowerCase();
  const m = medium.toLowerCase();
  if (s === 'google' && m === 'cpc' && /^\d+$/.test(detail[2] || '')) campaign = detail[2];
  if (s === 'google' && m === 'organic' && (detail[2] || '').startsWith('google_my_business')) campaign = detail[2];
  if (!campaign && attr.click_ids?.gad_campaignid) campaign = String(attr.click_ids.gad_campaignid);

  const who = (lead.customer?.email_sha256 || lead.customer?.phone_sha256 || id).toLowerCase();
  return {
    external_id: id,
    store_id: storeId,
    lead_date: date,
    created_at_utc: t.toISOString(),
    source,
    medium,
    campaign,
    lead_type: (lead.lead_type || '').trim(),
    form: (lead.form_name || '').trim(),
    contact_name: '',
    person_hash: createHash('sha256').update(who).digest('hex').slice(0, 16),
  };
}

const { data: client, error: cErr } = await sb
  .from('wheeler_reports_clients')
  .select('id, timezone')
  .eq('slug', 'al-rv-sales')
  .single();
if (cErr) throw cErr;

const { data: stores, error: sErr } = await sb
  .from('wheeler_reports_stores')
  .select('id, lead_locations')
  .eq('client_id', client.id);
if (sErr) throw sErr;

const byLocation = new Map();
for (const st of stores || []) {
  for (const loc of st.lead_locations || []) byLocation.set(String(loc).trim().toLowerCase(), st.id);
}

const { leads: raw, total } = await fetchAll();
const mapped = raw.map((l) => mapLead(l, byLocation, client.timezone || 'America/New_York')).filter(Boolean);
const unassigned = mapped.filter((l) => !l.store_id).length;
console.log(`mapped ${mapped.length} / api ${total}, unassigned store ${unassigned}`);

const started = new Date().toISOString();
const { data: run } = await sb
  .from('wheeler_reports_sync_runs')
  .insert({ client_id: client.id, kind: 'scout_leads', status: 'running', started_at: started })
  .select('id')
  .single();

try {
  for (let i = 0; i < mapped.length; i += 500) {
    const chunk = mapped.slice(i, i + 500).map((l) => ({
      ...l,
      client_id: client.id,
      imported_at: new Date().toISOString(),
    }));
    const { error } = await sb.from('wheeler_reports_leads').upsert(chunk, { onConflict: 'client_id,external_id' });
    if (error) throw error;
  }

  const { data: removed, error: delErr } = await sb
    .from('wheeler_reports_leads')
    .delete()
    .eq('client_id', client.id)
    .gte('lead_date', FROM)
    .lte('lead_date', TO)
    .like('external_id', 'ga4|%')
    .select('id');
  if (delErr) throw delErr;

  const msg = `Scout API: ${mapped.length} leads saved for ${FROM} to ${TO} (API total ${total}). Removed ${removed?.length ?? 0} GA4 synthetic leads. Unassigned store: ${unassigned}.`;
  if (run?.id) {
    await sb
      .from('wheeler_reports_sync_runs')
      .update({ status: 'ok', rows: mapped.length, message: msg, finished_at: new Date().toISOString() })
      .eq('id', run.id);
  }
  console.log(msg);

  const { data: bySrc } = await sb
    .from('wheeler_reports_leads')
    .select('source, medium')
    .eq('client_id', client.id)
    .gte('lead_date', FROM)
    .lte('lead_date', TO);
  const counts = {};
  for (const r of bySrc || []) {
    const k = `${r.source}/${r.medium}`;
    counts[k] = (counts[k] || 0) + 1;
  }
  console.log('by source/medium:', Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 12)));
} catch (e) {
  if (run?.id) {
    await sb
      .from('wheeler_reports_sync_runs')
      .update({ status: 'error', message: String(e?.message || e), finished_at: new Date().toISOString() })
      .eq('id', run.id);
  }
  throw e;
}
