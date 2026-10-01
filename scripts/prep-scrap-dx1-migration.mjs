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
const sql = fs.readFileSync('supabase/rpc/build_smart_final_data_scrap.sql', 'utf8');

// Use PostgREST isn't enough for DDL — call Supabase Management via psql-compatible
// service: run through mcp isn't available here. Use pg via fetch to SQL API if present.
// Fallback: print and use supabase-js to invoke a helper.

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Missing Supabase env');

const projectRef = new URL(url).hostname.split('.')[0];
const res = await fetch(`${url}/rest/v1/rpc/`, {
  method: 'POST',
  headers: {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({}),
});

console.log('project', projectRef, 'sql bytes', sql.length);
console.log('Write migration file for MCP apply…');
fs.writeFileSync(
  'supabase/migrations/20260926_scrap_step3_dx1_uuid_match.sql',
  sql
);
console.log('Wrote supabase/migrations/20260926_scrap_step3_dx1_uuid_match.sql');
