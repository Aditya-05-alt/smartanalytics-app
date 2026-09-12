/**
 * Run Admin Pipeline Step 4 logic_2 fill for A&L RV Sales (Sep MTD).
 *
 * Usage:
 *   node --import ./scripts/alias-loader.mjs scripts/run-al-sep-step4.mjs
 */
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import { runPipelineStep4 } from '@/lib/pipeline/step4Run.js';
import { parseVdpPath } from '@/lib/pipeline/logic2PathParse.js';

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

const CLIENT_ID = '2728830488';
const FROM = '2026-09-01';
const TO = '2026-09-11';

const samplePaths = [
  '/inventory/used/fifth-wheel-2021-grand-design-reflection-150-series-ut34687',
  '/inventory/new/travel-trailer-2027-grand-design-transcend-po16176',
  '/inventory/new/2027-grand-design-transcend-one-travel-trailer-151bh',
  '/inventory/new/2027-alliance-delta-travel-trailer-292rl-1',
  '/inventory/new/2026-flagstaff-e-pro-travel-trailer-e13le\',%20\'heading\':%20\'2026%20Forest%20River%20Flagstaff%20E-Pro%20E13LE',
  '/inventory/new/2026-forest-river-wildwood-x-lite-travel-trailer-263bhxlLifetime',
];

console.log('Parser smoke:');
for (const p of samplePaths) {
  console.log(JSON.stringify(parseVdpPath(p)));
}

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

console.log(`\nStep 4 A&L · ${FROM} → ${TO}`);
const started = Date.now();
const result = await runPipelineStep4(supabase, CLIENT_ID, {
  from: FROM,
  to: TO,
  syncLogic2FromLive: false,
  runSteps23: false,
  applyLogic2Fill: true,
});
const ms = Date.now() - started;

fs.writeFileSync(
  'exports/al_sep_step4_results.json',
  JSON.stringify({ from: FROM, to: TO, ms, result }, null, 2)
);

console.log(`Done in ${(ms / 1000).toFixed(1)}s`);
console.log((result.log || []).slice(-15).join('\n'));
console.log('Wrote exports/al_sep_step4_results.json');
