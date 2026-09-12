/**
 * Run Admin Pipeline Step 4 logic_2 fill for Happy Camper RV (Sep MTD).
 *
 * Usage:
 *   node --import ./scripts/alias-loader.mjs scripts/run-happy-camper-sep-step4.mjs
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

const CLIENT_ID = '5152307309';
const FROM = '2026-09-01';
const TO = '2026-09-11';

const samplePaths = [
  '/inventory/new/travel-trailer-2025-coachmen-shasta-compact-ht1423',
  '/inventory/used/fifth-wheel-2016-keystone-montana-r1535a',
  '/inventory/used/2016-thor-hurricane-class-a-r1581a',
  '/inventory/used/travel-trailer-2020-k-z-sportsman-c1470',
  '/inventory/used/travel-trailer-2021-oliver-travel-trailers-legacy-c1614',
  '/inventory/new/golf-cart-2024-gorilla-rides-ev-x4l-h1287',
  '/inventory/new/pop-up-2026-forest-river-flagstaff-classic-hardside-sofst10le',
  '/inventory/used/automotive-other-2018-ford-ecosport-rc1378',
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

console.log(`\nStep 4 Happy Camper · ${FROM} → ${TO}`);
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
  'exports/happy_camper_sep_step4_results.json',
  JSON.stringify({ from: FROM, to: TO, ms, result }, null, 2)
);

console.log(`Done in ${(ms / 1000).toFixed(1)}s`);
console.log((result.logic2Fill?.log || result.log || []).slice(-20).join('\n'));
console.log(
  `Unknown left: ${result.report?.unknowns?.uniqueUrls ?? '?'} urls / ${result.report?.unknowns?.totalViews ?? '?'} views`
);
console.log(
  `Exceptions: ${result.report?.exceptions?.uniqueUrls ?? '?'} urls / ${result.report?.exceptions?.totalViews ?? '?'} views`
);
console.log('Wrote exports/happy_camper_sep_step4_results.json');
