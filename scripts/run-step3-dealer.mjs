/**
 * Step 3 only — build_smart_final_data for one dealer, 1-day chunks + retries.
 *   node scripts/run-step3-dealer.mjs --clientId=9052006098 --from=2026-06-01 --to=2026-08-30
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

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
      })
  );
}

function parseArgs() {
  const out = {};
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--([^=]+)=(.+)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function datesBetween(from, to) {
  const out = [];
  let cur = new Date(from + 'T00:00:00Z');
  const end = new Date(to + 'T00:00:00Z');
  while (cur <= end) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryable(msg) {
  return /520|522|524|502|503|timeout|timed out|fetch failed|ECONNRESET|upstream/i.test(
    msg || ''
  );
}

async function rpcDay(sb, clientId, day, attempts = 4) {
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    const { data, error } = await sb.rpc('build_smart_final_data', {
      p_client_id: clientId,
      p_date_from: day,
      p_date_to: day,
      p_days_back: null,
    });
    if (!error) return data;
    lastErr = error;
    if (!isRetryable(error.message) || i === attempts - 1) throw error;
    await sleep(2000 * (i + 1));
  }
  throw lastErr;
}

async function main() {
  const args = parseArgs();
  const clientId = String(args.clientId || '').trim();
  const FROM = args.from || '2026-06-01';
  const TO = args.to || '2026-08-30';
  if (!clientId) throw new Error('--clientId required');

  const env = loadEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY;
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const { data: cfg } = await sb
    .from('smart_ga4_config')
    .select('account_name')
    .eq('client_id', clientId)
    .maybeSingle();

  const days = datesBetween(FROM, TO);
  console.log(
    `Step 3 — ${cfg?.account_name || clientId} (${clientId}) · ${FROM} → ${TO} · ${days.length} days`
  );

  let totalRows = 0;
  let totalMatched = 0;
  let failed = [];

  for (const day of days) {
    process.stdout.write(`  ${day} ... `);
    try {
      const data = await rpcDay(sb, clientId, day);
      const rows = Number(data?.[0]?.out_total_rows ?? 0);
      const matched = Number(data?.[0]?.out_vdp_true_rows ?? 0);
      totalRows += rows;
      totalMatched += matched;
      console.log(`${rows} rows · ${matched} matched`);
    } catch (e) {
      const msg = (e.message || String(e)).slice(0, 100);
      console.log(`FAILED: ${msg}`);
      failed.push(day);
    }
    await sleep(100);
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Dealer: ${cfg?.account_name || clientId}`);
  console.log(`Range: ${FROM} → ${TO}`);
  console.log(`Final rows: ${totalRows.toLocaleString()}`);
  console.log(`Matched: ${totalMatched.toLocaleString()}`);
  if (failed.length) {
    console.log(`Failed days (${failed.length}): ${failed.join(', ')}`);
    process.exit(1);
  }
  console.log('Done.');
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
