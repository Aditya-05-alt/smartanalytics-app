/**
 * Assign store_id on unassigned A&L leads (migration mapping).
 * Weights = existing per-store lead counts so distribution matches current mix.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const ROOT = path.resolve('c:/htmls/Smart_analytics_Main/smartanalytics-app');

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

async function allIds(clientId) {
  const ids = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from('wheeler_reports_leads')
      .select('id')
      .eq('client_id', clientId)
      .is('store_id', null)
      .range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    ids.push(...data.map((d) => d.id));
    if (data.length < 1000) break;
  }
  return ids;
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
    .select('id, name, sort')
    .eq('client_id', client.id)
    .order('sort');
  if (sErr) throw sErr;

  const weights = Object.fromEntries(stores.map((s) => [s.id, 0]));
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from('wheeler_reports_leads')
      .select('store_id')
      .eq('client_id', client.id)
      .not('store_id', 'is', null)
      .range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    for (const r of data) weights[r.store_id] = (weights[r.store_id] || 0) + 1;
    if (data.length < 1000) break;
  }

  let totalW = Object.values(weights).reduce((a, b) => a + b, 0);
  if (!totalW) {
    for (const s of stores) weights[s.id] = 1;
    totalW = stores.length;
  }

  const ids = await allIds(client.id);
  const bag = [];
  for (const s of stores) {
    const n = Math.max(1, Math.round((weights[s.id] / totalW) * 100));
    for (let i = 0; i < n; i++) bag.push(s.id);
  }

  const updates = {};
  ids.forEach((id, i) => {
    const sid = bag[i % bag.length];
    (updates[sid] ||= []).push(id);
  });

  const summary = [];
  for (const s of stores) {
    const list = updates[s.id] || [];
    for (let i = 0; i < list.length; i += 200) {
      const { error } = await sb
        .from('wheeler_reports_leads')
        .update({ store_id: s.id })
        .in('id', list.slice(i, i + 200));
      if (error) throw error;
    }
    summary.push({ store: s.name, assigned: list.length, prior_weight: weights[s.id] });
  }

  const { count } = await sb
    .from('wheeler_reports_leads')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', client.id)
    .is('store_id', null);

  console.log(JSON.stringify({ ok: true, remapped: ids.length, remaining_unassigned: count, summary }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
