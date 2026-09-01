/**
 * Backfill Step 3 — Hoot / QS / Scrap kept independent (same as edge functions).
 *
 *   node scripts/backfill-step3-all-dealers.mjs
 *   node scripts/backfill-step3-all-dealers.mjs --hootOnly
 *   node scripts/backfill-step3-all-dealers.mjs --qsOnly
 *   node scripts/backfill-step3-all-dealers.mjs --scrapOnly
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const PAGE_PATH_QS_CLIENT_IDS = new Set(['1421445735']);

/** Keep Hoot / QS / Scrap independent — same split as edge functions. */
function loadEnv() {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const envPath = path.join(root, '..', '.env.local');
  return Object.fromEntries(
    fs
      .readFileSync(envPath, 'utf8')
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => {
        const i = l.indexOf('=');
        const val = l.slice(i + 1).trim();
        return [l.slice(0, i).trim(), val.replace(/^["']|["']$/g, '')];
      }),
  );
}

function parseArgs() {
  const out = { daysBack: 7, hootOnly: false, scrapOnly: false, qsOnly: false };
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--([^=]+)(?:=(.+))?$/);
    if (!m) continue;
    const [, key, val] = m;
    if (key === 'daysBack') out.daysBack = Number(val ?? 7);
    else if (key === 'hootOnly') out.hootOnly = true;
    else if (key === 'scrapOnly') out.scrapOnly = true;
    else if (key === 'qsOnly') out.qsOnly = true;
  }
  return out;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runQsDealers(sb, daysBack) {
  const clientIds = [...PAGE_PATH_QS_CLIENT_IDS];
  console.log(`\n=== QS Step 3 — ${clientIds.length} dealers (days_back=${daysBack}) ===\n`);

  let ok = 0;
  let fail = 0;
  let totalRows = 0;
  let totalVdp = 0;
  const failures = [];

  for (const clientId of clientIds) {
    process.stdout.write(`  ${clientId} … `);
    const { data, error: rpcErr } = await sb.rpc('build_smart_final_data_qs', {
      p_client_id: clientId,
      p_days_back: daysBack,
      p_date_from: null,
      p_date_to: null,
    });
    if (rpcErr) {
      console.log(`FAIL — ${rpcErr.message}`);
      fail++;
      failures.push({ clientId, name: clientId, error: rpcErr.message });
      continue;
    }
    const row = data?.[0];
    const rows = Number(row?.out_total_rows ?? 0);
    const vdp = Number(row?.out_vdp_true_rows ?? 0);
    totalRows += rows;
    totalVdp += vdp;
    ok++;
    console.log(`${rows} rows · ${vdp} matched`);
  }

  return { ok, fail, totalRows, totalVdp, failures, dealerCount: clientIds.length };
}

async function runHootDealers(sb, daysBack) {
  const [{ data: dealers, error }, { data: scrapDealers }] = await Promise.all([
    sb
      .from('smart_ga4_config')
      .select('client_id, account_name')
      .eq('is_active', true)
      .order('client_id', { ascending: true }),
    sb.rpc('get_scrap_dealers_for_sync', { p_client_id: null }),
  ]);

  if (error) throw error;

  const scrapSkip = new Set(
    (scrapDealers || [])
      .map((d) => String(d.ga4_customer_id ?? '').trim())
      .filter(Boolean),
  );

  const hootDealers = (dealers || []).filter((d) => {
    const id = String(d.client_id).trim();
    return !PAGE_PATH_QS_CLIENT_IDS.has(id) && !scrapSkip.has(id);
  });

  console.log(
    `\n=== Hoot Step 3 — ${hootDealers.length} dealers (skip QS=${PAGE_PATH_QS_CLIENT_IDS.size}, scrap=${scrapSkip.size}) days_back=${daysBack} ===\n`,
  );

  let ok = 0;
  let fail = 0;
  let totalRows = 0;
  let totalVdp = 0;
  const failures = [];

  for (const d of hootDealers) {
    const clientId = String(d.client_id).trim();
    process.stdout.write(`  [${ok + fail + 1}/${hootDealers.length}] ${d.account_name || clientId} … `);

    const { data, error: rpcErr } = await sb.rpc('build_smart_final_data', {
      p_client_id: clientId,
      p_days_back: daysBack,
      p_date_from: null,
      p_date_to: null,
    });

    if (rpcErr) {
      console.log(`FAIL — ${rpcErr.message}`);
      fail++;
      failures.push({ clientId, name: d.account_name, error: rpcErr.message });
      await sleep(300);
      continue;
    }

    const row = data?.[0];
    const rows = Number(row?.out_total_rows ?? 0);
    const vdp = Number(row?.out_vdp_true_rows ?? 0);
    totalRows += rows;
    totalVdp += vdp;
    ok++;
    console.log(`${rows} rows · ${vdp} matched`);
    await sleep(150);
  }

  return { ok, fail, totalRows, totalVdp, failures, dealerCount: hootDealers.length };
}

async function runScrapDealers(sb, daysBack) {
  const { data: scrapDealers, error } = await sb.rpc('get_scrap_dealers_for_sync', {
    p_client_id: null,
  });
  if (error) throw error;

  console.log(
    `\n=== Scrap Step 3 — ${scrapDealers.length} dealers (days_back=${daysBack}) ===\n`,
  );

  let ok = 0;
  let fail = 0;
  let totalRows = 0;
  let totalVdp = 0;
  const failures = [];

  for (const d of scrapDealers) {
    const clientId = String(d.ga4_customer_id).trim();
    const name = d.customer_name || clientId;
    process.stdout.write(`  [${ok + fail + 1}/${scrapDealers.length}] ${name} … `);

    const { data, error: rpcErr } = await sb.rpc('build_smart_final_data_scrap', {
      p_client_id: clientId,
      p_days_back: daysBack,
      p_date_from: null,
      p_date_to: null,
    });

    if (rpcErr) {
      console.log(`FAIL — ${rpcErr.message}`);
      fail++;
      failures.push({ clientId, name, error: rpcErr.message });
      await sleep(300);
      continue;
    }

    const row = data?.[0];
    const rows = Number(row?.out_total_rows ?? 0);
    const vdp = Number(row?.out_vdp_true_rows ?? 0);
    totalRows += rows;
    totalVdp += vdp;
    ok++;
    console.log(`${rows} rows · ${vdp} matched`);
    await sleep(150);
  }

  return { ok, fail, totalRows, totalVdp, failures, dealerCount: scrapDealers.length };
}

async function main() {
  const args = parseArgs();
  const env = loadEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Missing Supabase URL or service role key in .env.local');

  const sb = createClient(url, key, { auth: { persistSession: false } });

  const results = {};
  const runAll = !args.hootOnly && !args.scrapOnly && !args.qsOnly;

  if (runAll || args.hootOnly) {
    results.hoot = await runHootDealers(sb, args.daysBack);
  }
  if (runAll || args.qsOnly) {
    results.qs = await runQsDealers(sb, args.daysBack);
  }
  if (runAll || args.scrapOnly) {
    results.scrap = await runScrapDealers(sb, args.daysBack);
  }

  console.log('\n=== SUMMARY ===');
  for (const [label, r] of Object.entries(results)) {
    console.log(
      `${label}: ${r.ok}/${r.dealerCount} ok · ${r.totalRows.toLocaleString()} rows · ${r.totalVdp.toLocaleString()} matched`,
    );
    if (r.failures.length) {
      console.log(`  failures (${r.failures.length}):`);
      for (const f of r.failures) console.log(`    - ${f.name} (${f.clientId}): ${f.error}`);
    }
  }

  const anyFail = Object.values(results).some((r) => r.fail > 0);
  if (anyFail) process.exit(1);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
