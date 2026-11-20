/**
 * Backfill A&L Wheeler Reports leads from smart_events_data (GA4 form submits).
 * Range: 2026-10-01 .. 2026-11-26
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const ROOT = path.resolve('c:/htmls/Smart_analytics_Main/smartanalytics-app');
const FROM = '2026-10-01';
const TO = '2026-11-26';
const GA4_CLIENT = '2728830488';

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

const LOC_RULES = [
  { re: /murfreesboro|christiana/i, key: 'murfreesboro' },
  { re: /johnson[-_ ]?city|kodak/i, key: 'johnson city' },
  { re: /lake[-_ ]?park/i, key: 'lake park' },
  { re: /chocowinity|greenville/i, key: 'greenville' },
  { re: /sevierville/i, key: 'sevierville' },
  { re: /richmond/i, key: 'richmond' },
  { re: /jackson/i, key: 'jackson' },
  { re: /columbia/i, key: 'columbia' },
];

function storeIdFromText(text, termToStore) {
  const hay = String(text || '');
  for (const rule of LOC_RULES) {
    if (rule.re.test(hay) && termToStore.has(rule.key)) return termToStore.get(rule.key);
  }
  // fallback: any campaign_term substring
  const low = hay.toLowerCase();
  for (const [term, id] of termToStore) {
    if (term && low.includes(term)) return id;
  }
  return null;
}

function normalizeSourceMedium(source, medium) {
  let s = String(source || '').trim();
  let m = String(medium || '').trim();
  if (!s || s === '(direct)' || s.toLowerCase() === 'direct') {
    s = '(direct)';
    m = m || '(none)';
  }
  if (/^facebook/i.test(s)) s = 'facebook';
  if (!m) m = '(none)';
  if (s === '(data not available)' || s === '(not set)') {
    s = '(direct)';
    m = '(none)';
  }
  return { source: s, medium: m };
}

function formLabel(eventName, commonForm) {
  const raw = String(commonForm || eventName || '').trim();
  const map = {
    other_form_submit: 'Other form',
    financing_submit: 'Financing',
    contact_us_submit: 'Contact Us',
    trade_value_submit: 'Trade-In',
    parts_submit: 'Parts',
    payment_calc_submit: 'Payment calc',
    custom_form_submit: 'Custom Form',
  };
  return map[raw] || raw || 'Unknown';
}

async function main() {
  const { data: client, error: cErr } = await sb
    .from('wheeler_reports_clients')
    .select('id, slug, name, timezone')
    .eq('slug', 'al-rv-sales')
    .single();
  if (cErr) throw cErr;

  const { data: stores, error: sErr } = await sb
    .from('wheeler_reports_stores')
    .select('id, name, sort, campaign_terms, lead_locations')
    .eq('client_id', client.id)
    .order('sort');
  if (sErr) throw sErr;

  const termToStore = new Map();
  for (const s of stores) {
    for (const t of s.campaign_terms || []) termToStore.set(String(t).toLowerCase(), s.id);
    for (const loc of s.lead_locations || []) termToStore.set(String(loc).toLowerCase(), s.id);
  }

  // Page through GA4 event rows
  const events = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from('smart_events_data')
      .select(
        'report_date, event_name, common_form, page_path, page_location, source, medium, session_campaign, event_count',
      )
      .eq('client_id', GA4_CLIENT)
      .gte('report_date', FROM)
      .lte('report_date', TO)
      .gt('event_count', 0)
      .order('report_date')
      .range(from, from + 999);
    if (error) throw error;
    events.push(...(data || []));
    if (!data || data.length < 1000) break;
  }

  console.log(`Event aggregate rows: ${events.length}`);

  const leads = [];
  let unassigned = 0;
  let seq = 0;
  for (let rowIdx = 0; rowIdx < events.length; rowIdx++) {
    const e = events[rowIdx];
    const count = Math.max(1, Number(e.event_count) || 0);
    const pathText = e.page_path || e.page_location || '';
    const campaign = String(e.session_campaign || '').trim();
    const storeId =
      storeIdFromText(pathText, termToStore) || storeIdFromText(campaign, termToStore);
    if (!storeId) unassigned += count;
    const { source, medium } = normalizeSourceMedium(e.source, e.medium);
    const form = formLabel(e.event_name, e.common_form);

    for (let i = 0; i < count; i++) {
      seq += 1;
      leads.push({
        client_id: client.id,
        store_id: storeId,
        external_id: `ga4|${GA4_CLIENT}|${FROM}_${TO}|${seq}`,
        lead_date: e.report_date,
        created_at_utc: `${e.report_date}T12:00:00.000Z`,
        source,
        medium,
        campaign,
        lead_type: e.event_name || '',
        form,
        person_hash: null,
        imported_at: new Date().toISOString(),
      });
    }
  }

  console.log(`Expanded leads: ${leads.length} (unassigned events: ${unassigned})`);

  // Replace prior GA4-imported leads for this client in range (keep any non-ga4 uploads)
  const { data: existing, error: exErr } = await sb
    .from('wheeler_reports_leads')
    .select('id, external_id')
    .eq('client_id', client.id)
    .gte('lead_date', FROM)
    .lte('lead_date', TO)
    .like('external_id', 'ga4|%');
  if (exErr) throw exErr;
  if (existing?.length) {
    const ids = existing.map((r) => r.id);
    for (let i = 0; i < ids.length; i += 500) {
      const { error } = await sb.from('wheeler_reports_leads').delete().in('id', ids.slice(i, i + 500));
      if (error) throw error;
    }
    console.log(`Removed previous GA4 leads: ${ids.length}`);
  }

  for (let i = 0; i < leads.length; i += 500) {
    const slice = leads.slice(i, i + 500);
    const { error } = await sb.from('wheeler_reports_leads').upsert(slice, {
      onConflict: 'client_id,external_id',
    });
    if (error) throw error;
    console.log(`Upserted ${Math.min(i + 500, leads.length)} / ${leads.length}`);
  }

  // Quick source breakdown
  const buckets = {};
  for (const l of leads) {
    const s = l.source.toLowerCase();
    const m = l.medium.toLowerCase();
    let key = 'other';
    if (s === 'google' && m === 'cpc') key = 'google_ads';
    else if (s === 'google' && m === 'organic') key = 'google_organic';
    else if (s === '(direct)' || s === 'direct') key = 'direct';
    else if (s.startsWith('facebook')) key = 'facebook';
    else if (s.startsWith('rvtrader')) key = 'rv_trader';
    buckets[key] = (buckets[key] || 0) + 1;
  }

  console.log(JSON.stringify({ ok: true, leads: leads.length, unassigned, buckets }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
