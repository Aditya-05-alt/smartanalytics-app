/**
 * Fort Kent Powersports — full September 2026 re-sync.
 * Step 1 (GA4) → Step 2 (filtration) → Step 3 (final).
 *
 *   node --import ./scripts/alias-loader.mjs scripts/run-fort-kent-sep-2026.mjs
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
    let v = t.slice(i + 1);
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    env[t.slice(0, i)] = v;
    if (!process.env[t.slice(0, i)]) process.env[t.slice(0, i)] = v;
  }
  return env;
}

const env = loadEnvLocal();

const { syncGa4PageDataForDealer } = await import('@/lib/pipeline/ga4PageSync.js');
const { runVdpFiltration, runFinalVdpSync } = await import(
  '@/lib/pipeline/pipelineRpc.js'
);
const { chunkDates, coerceDateRange } = await import('@/lib/pipeline/dates.js');
const { STEP1_BATCH_SIZE } = await import('@/lib/pipeline/syncLogFormat.js');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const FROM = '2026-09-01';
const TO = '2026-09-26';
const DEALER = {
  clientId: '3454932870',
  name: 'Fort Kent Powersports',
};

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY;
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
if (
  !process.env.GCP_SERVICE_ACCOUNT_JSON &&
  !process.env.GCP_SERVICE_ACCOUNT_JSON_PATH
) {
  console.error('Missing GCP_SERVICE_ACCOUNT_JSON in .env.local');
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { dates } = coerceDateRange(FROM, TO);
const batches = chunkDates(dates, STEP1_BATCH_SIZE);

console.log(
  `${DEALER.name} (${DEALER.clientId}) · ${FROM} → ${TO} · ${dates.length} days · Step1 batches=${batches.length}`
);

const started = Date.now();
const row = {
  clientId: DEALER.clientId,
  name: DEALER.name,
  step1Rows: 0,
  step1OkDays: 0,
  step1Errors: [],
  step2Updated: 0,
  step3: null,
  error: null,
};

try {
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const batchFrom = batch[0];
    const batchTo = batch[batch.length - 1];
    console.log(
      `Step 1 batch ${i + 1}/${batches.length}: ${batchFrom} → ${batchTo}`
    );
    const res = await syncGa4PageDataForDealer(supabase, {
      clientId: DEALER.clientId,
      dateFrom: batchFrom,
      dateTo: batchTo,
    });
    row.step1Rows += Number(res?.rowsUpserted ?? res?.totalRows ?? 0) || 0;
    row.step1OkDays += batch.length;
    if (res?.errors?.length) row.step1Errors.push(...res.errors);
    await sleep(400);
  }

  console.log('Step 2 filtration…');
  const step2 = await runVdpFiltration(supabase, DEALER.clientId, {
    from: FROM,
    to: TO,
  });
  row.step2Updated = step2.totalRowsUpdated;
  console.log(`Step 2 updated: ${row.step2Updated}`);

  console.log('Step 3 final…');
  const step3 = await runFinalVdpSync(supabase, DEALER.clientId, {
    from: FROM,
    to: TO,
  });
  row.step3 = step3;
  console.log(`Step 3 rows: ${step3?.totalRows ?? step3?.rows ?? JSON.stringify(step3)}`);
} catch (err) {
  row.error = err?.message || String(err);
  console.error('FAILED:', row.error);
  process.exitCode = 1;
}

const secs = ((Date.now() - started) / 1000).toFixed(1);
console.log('\n=== DONE ===');
console.log(JSON.stringify({ ...row, elapsedSec: secs }, null, 2));
