/**
 * Backfill Interact RV dealers (excl Midway + Utah) full 2026:
 * make/model from product URL + type from smart_custom_unknown_fillers.
 *
 * Usage: node scripts/backfill-interact-2026-mm-type.mjs
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
const FROM = '2026-01-01';
const TO = '2027-01-01';

const env = loadEnvLocal();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Missing Supabase env');

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  db: { schema: 'public' },
});

async function rpcSql(label, query) {
  // Use PostgREST rpc if available; otherwise fall back to REST not possible for raw SQL.
  // We'll call via fetch to the SQL endpoint isn't public — use supabase.rpc only if function exists.
  // Prefer: execute through a one-off DB function created below.
  const { data, error } = await supabase.rpc('exec_sql_json', { q: query });
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

async function main() {
  // Ensure helper exists
  const { error: createErr } = await supabase.rpc('exec_sql_json', {
    q: `
CREATE OR REPLACE FUNCTION public.exec_sql_json(q text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '180s'
AS $$
DECLARE
  result json;
BEGIN
  EXECUTE 'SELECT COALESCE(json_agg(t), ''[]''::json) FROM (' || q || ') t' INTO result;
  RETURN result;
EXCEPTION WHEN OTHERS THEN
  -- For statements that don't return rows (UPDATE), run directly
  BEGIN
    EXECUTE q;
    RETURN json_build_object('ok', true);
  EXCEPTION WHEN OTHERS THEN
    RAISE;
  END;
END;
$$;
`,
  });

  if (createErr) {
    console.error('Cannot create exec helper via rpc. Using per-dealer MCP-style updates through edge is required.');
    console.error(createErr);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
