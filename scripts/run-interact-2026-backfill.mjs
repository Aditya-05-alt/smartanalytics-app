/**
 * Run backfill_interact_dealer_2026 for each Interact RV dealer
 * except Midway (6460838510) and Utah (5978801601).
 *
 * Usage: node scripts/run-interact-2026-backfill.mjs
 */
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

function loadEnvLocal() {
  const raw = fs.readFileSync('.env.local', 'utf8');
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    env[t.slice(0, i)] = t.slice(i + 1);
  }
  return env;
}

const EXCLUDE = new Set(['6460838510', '5978801601']);

const env = loadEnvLocal();
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: configs, error: cfgErr } = await supabase
  .from('smart_hoot_config')
  .select('ga4_customer_id, customer_name, is_active')
  .eq('website_platform', 'Interact RV');

if (cfgErr) throw cfgErr;

const byId = new Map();
for (const row of configs || []) {
  const id = String(row.ga4_customer_id);
  if (EXCLUDE.has(id)) continue;
  const prev = byId.get(id);
  if (!prev || (row.is_active && !prev.is_active)) {
    byId.set(id, { id, name: row.customer_name, is_active: row.is_active });
  }
}

const dealers = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
console.log(`Dealers to process: ${dealers.length}`);
const results = [];

for (const d of dealers) {
  process.stdout.write(`→ ${d.name} (${d.id}) ... `);
  const started = Date.now();
  const { data, error } = await supabase.rpc('backfill_interact_dealer_2026', {
    p_client_id: d.id,
  });
  const ms = Date.now() - started;
  if (error) {
    console.log(`FAIL ${ms}ms: ${error.message}`);
    results.push({ ...d, error: error.message, ms });
    continue;
  }
  console.log(`ok ${ms}ms`, JSON.stringify(data));
  results.push({ ...d, ...(typeof data === 'object' ? data : { data }), ms });
}

fs.writeFileSync(
  'exports/interact_2026_backfill_results.json',
  JSON.stringify(results, null, 2),
);
console.log('Wrote exports/interact_2026_backfill_results.json');
