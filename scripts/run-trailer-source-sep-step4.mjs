/**
 * Expand Trailer Source logic_2 + run Sep Step 4 fill.
 * Usage: node --import ./scripts/alias-loader.mjs scripts/run-trailer-source-sep-step4.mjs
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

const CLIENT_ID = '4668711550';
const FROM = '2026-09-01';
const TO = '2026-09-12';

const VDP_LOGIC =
  '^/inventory/(?:(?:new|used)/\\d{4}-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+|(?:new|used)/(?:travel-trailer|fifth-wheel|toy-hauler|class-[abc]|destination-trailer|utility-trailer|trailer-utility|cargo-trailer-enclosed|cargo-trailer|dump-trailer|tilt-trailer|car-hauler|roll-off-trailer|gooseneck-trailer|equipment-trailer|deck-over-trailer|boat|pickup-truck|suv|other|pop-up|motorcycle)-\\d{4}-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+|(?:new|used)/(?:[A-Za-z]{1,4}-?)?\\d{3,}[A-Za-z0-9]*|used-\\d{4}-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+)/?$';

const samplePaths = [
  '/inventory/new/utility-trailer-2027-voyager-manufacturer-echo-1934',
  '/inventory/used/utility-trailer-2026-echo-7x14-1901',
  '/inventory/new/cargo-trailer-2027-novae-llc-pace-american-1652',
  '/inventory/new/dump-trailer-2026-silver-armor-buckshot-trailers-2008',
  '/inventory/new/2026-alcom-llc-xpress-cargo-trailer-enclosed-tb056149',
  '/inventory/used/trailer-utility-2026-homemade-homemade-1999',
  '/inventory/new/car-hauler-2027-pj-trailers-pj-1939',
  '/inventory/used/2151',
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

const { data: logicUpd, error: logicErr } = await supabase
  .from('smart_vdp_logic_2')
  .update({ vdp_logic: VDP_LOGIC, updated_at: new Date().toISOString() })
  .eq('dealer_id', CLIENT_ID)
  .select('dealer_id, dealer_name')
  .maybeSingle();
if (logicErr) {
  console.error('logic_2 update failed', logicErr);
  process.exit(1);
}
console.log('logic_2 updated', logicUpd);

console.log(`\nStep 4 Trailer Source · ${FROM} → ${TO}`);
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
  'exports/trailer_source_sep_step4_results.json',
  JSON.stringify({ from: FROM, to: TO, ms, result }, null, 2)
);

console.log(`Done in ${(ms / 1000).toFixed(1)}s`);
console.log((result.logic2Fill?.log || []).slice(-30).join('\n'));
console.log(
  `Unknown left: ${result.report?.unknowns?.uniqueUrls ?? '?'} urls / ${result.report?.unknowns?.totalViews ?? '?'} views`
);
console.log(
  `Exceptions: ${result.report?.exceptions?.uniqueUrls ?? '?'} urls / ${result.report?.exceptions?.totalViews ?? '?'} views`
);
console.log('Wrote exports/trailer_source_sep_step4_results.json');
