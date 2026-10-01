import fs from 'fs';

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

const env = loadEnvLocal();
const sql = fs.readFileSync(
  'supabase/migrations/20260926_scrap_step3_dx1_uuid_match.sql',
  'utf8'
);

const keys = Object.keys(env).filter((k) =>
  /DATABASE|POSTGRES|DB_URL|DIRECT/i.test(k)
);
console.log('db-related env keys:', keys);

const dbUrl =
  env.DATABASE_URL ||
  env.SUPABASE_DB_URL ||
  env.POSTGRES_URL ||
  env.DIRECT_URL;

if (!dbUrl) {
  console.error('No DATABASE_URL — use MCP apply_migration');
  process.exit(2);
}

const { default: pg } = await import('pg').catch(() => ({ default: null }));
if (!pg) {
  console.error('pg package missing');
  process.exit(3);
}

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query(sql);
  console.log('Applied scrap Step 3 DX1 UUID match RPC');
} finally {
  await client.end();
}
