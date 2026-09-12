/**
 * Run Admin Pipeline Step 4 for Interact RV dealers (Sep MTD),
 * excluding Happy Camper RV and Bill Thomas Campers.
 *
 * Usage:
 *   node --import ./scripts/alias-loader.mjs scripts/run-interact-sep-step4.mjs
 */
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import { runPipelineStep4 } from '@/lib/pipeline/step4Run.js';

function loadEnvLocal() {
  const raw = fs.readFileSync('.env.local', 'utf8');
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    let v = t.slice(i + 1);
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    env[t.slice(0, i)] = v;
  }
  return env;
}

const EXCLUDE = new Set(['5152307309', '5364794945']); // Happy Camper, Bill Thomas
const FROM = '2026-09-01';
const TO = '2026-09-11';

const env = loadEnvLocal();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY;
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: logicRows, error: logicErr } = await supabase
  .from('smart_vdp_logic_2')
  .select('dealer_id, dealer_name, cms, vdp_logic')
  .ilike('cms', 'Interact RV');

if (logicErr) throw logicErr;

const byId = new Map();
for (const row of logicRows || []) {
  const id = String(row.dealer_id || '').trim();
  if (!id || EXCLUDE.has(id)) continue;
  const prev = byId.get(id);
  if (!prev) {
    byId.set(id, {
      id,
      name: row.dealer_name || id,
      hasLogic: Boolean(String(row.vdp_logic || '').trim()),
    });
  }
}

const dealers = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
console.log(
  `Step 4 Interact · ${FROM} → ${TO} · ${dealers.length} dealer(s) (excl Happy Camper + Bill Thomas)`
);

const results = [];

for (const d of dealers) {
  process.stdout.write(`\n→ ${d.name} (${d.id}) … `);
  const started = Date.now();
  try {
    const result = await runPipelineStep4(supabase, d.id, {
      from: FROM,
      to: TO,
      syncLogic2FromLive: true,
      runSteps23: true,
      applyLogic2Fill: true,
    });
    const ms = Date.now() - started;
    const unk = result.report?.unknowns;
    const fill = result.logic2Fill;
    console.log(
      `ok ${(ms / 1000).toFixed(1)}s · unknown ${unk?.uniqueUrls ?? '?'} paths / ${unk?.totalViews ?? '?'} views · fill rows ${fill?.updatedFinalRows ?? 0}`
    );
    results.push({
      name: d.name,
      id: d.id,
      ok: true,
      ms,
      unknownUrls: unk?.uniqueUrls ?? null,
      unknownViews: unk?.totalViews ?? null,
      exceptionUrls: result.report?.exceptions?.uniqueUrls ?? null,
      exceptionViews: result.report?.exceptions?.totalViews ?? null,
      finalVdp: result.report?.finalVdp ?? null,
      ga4Vdp: result.report?.ga4Vdp ?? null,
      updatedFinalRows: fill?.updatedFinalRows ?? 0,
      updatedGa4Rows: fill?.updatedGa4Rows ?? 0,
      typeFilled: fill?.typeFilled ?? 0,
      logTail: (result.log || []).slice(-8),
    });
  } catch (err) {
    const ms = Date.now() - started;
    console.log(`FAIL ${(ms / 1000).toFixed(1)}s: ${err?.message || err}`);
    results.push({
      name: d.name,
      id: d.id,
      ok: false,
      ms,
      error: err?.message || String(err),
    });
  }
}

fs.writeFileSync(
  'exports/interact_sep_step4_results.json',
  JSON.stringify({ from: FROM, to: TO, exclude: [...EXCLUDE], results }, null, 2)
);
console.log('\nWrote exports/interact_sep_step4_results.json');

console.log('\nSummary:');
for (const r of results) {
  if (!r.ok) {
    console.log(`  FAIL  ${r.name}: ${r.error}`);
    continue;
  }
  console.log(
    `  ${String(r.unknownViews ?? 0).padStart(6)} unk views · ${String(r.unknownUrls ?? 0).padStart(4)} urls · ${r.name}`
  );
}
