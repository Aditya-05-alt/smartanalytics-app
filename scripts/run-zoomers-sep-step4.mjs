/**
 * Run Admin Pipeline Step 4 logic_2 fill for Zoomers RV (Sep MTD).
 *
 * Usage:
 *   node --import ./scripts/alias-loader.mjs scripts/run-zoomers-sep-step4.mjs
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

const CLIENT_ID = '5691491478';
const FROM = '2026-09-01';
const TO = '2026-09-12';

const samplePaths = [
  '/inventory/used/class-c-2019-forest-river-sunseeker-10409',
  '/inventory/new/travel-trailer-2027-rockwood-geo-pro-10284',
  '/inventory/used/class-a-2022-entegra-coach-vision-10404',
  '/inventory/used/boat-2017-tracker-pro-team-10355',
  '/inventory/used/pickup-truck-2015-ford-f-250-super-duty-10297',
  '/inventory/used/motorcycle-1985-honda-rebel-c2117',
  '/inventory/used/c-2114',
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

console.log(`\nStep 4 Zoomers · ${FROM} → ${TO}`);
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
  'exports/zoomers_sep_step4_results.json',
  JSON.stringify({ from: FROM, to: TO, ms, result }, null, 2)
);

console.log(`Done in ${(ms / 1000).toFixed(1)}s`);
console.log((result.logic2Fill?.log || []).slice(-20).join('\n'));
console.log(
  `Unknown left: ${result.report?.unknowns?.uniqueUrls ?? '?'} urls / ${result.report?.unknowns?.totalViews ?? '?'} views`
);
console.log(
  `Exceptions: ${result.report?.exceptions?.uniqueUrls ?? '?'} urls / ${result.report?.exceptions?.totalViews ?? '?'} views`
);
console.log('Wrote exports/zoomers_sep_step4_results.json');
