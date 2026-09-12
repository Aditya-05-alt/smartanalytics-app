/**
 * Re-fill Zoomers stock-only exception /inventory/used/c-2114 (Sep).
 * Usage: node --import ./scripts/alias-loader.mjs scripts/run-zoomers-stock-fill.mjs
 */
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import { applyLogic2UnknownFill } from '@/lib/pipeline/logic2UnknownFill.js';
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

console.log('parse', parseVdpPath('/inventory/used/c-2114'));

const env = loadEnvLocal();
const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const result = await applyLogic2UnknownFill(supabase, CLIENT_ID, FROM, TO);
console.log((result.log || []).join('\n'));
console.log(
  JSON.stringify(
    {
      matchedPaths: result.matchedPaths,
      exceptionCandidates: result.exceptionCandidates,
      updatedFinalRows: result.updatedFinalRows,
      updatedGa4Rows: result.updatedGa4Rows,
    },
    null,
    2
  )
);
