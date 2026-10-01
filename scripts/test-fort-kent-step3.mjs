import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import { runFinalVdpSync } from '../src/lib/pipeline/pipelineRpc.js';

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
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Probe whether DX1 match is already in live scrap RPC by checking function source
const { data, error } = await sb.rpc('build_smart_final_data_scrap', {
  p_client_id: '3454932870',
  p_date_from: '2026-09-01',
  p_date_to: '2026-09-25',
});
if (error) {
  console.error('step3 error', error.message);
  process.exit(1);
}
console.log('step3 result', JSON.stringify(data, null, 2));

const { data: sample, error: e2 } = await sb
  .from('smart_final_data')
  .select('inv_make, inv_model, inv_type, inv_condition, inv_location')
  .eq('client_id', '3454932870')
  .gte('report_date', '2026-09-01')
  .lte('report_date', '2026-09-25')
  .not('inv_make', 'is', null)
  .limit(5);
console.log('sample matched', e2?.message || sample);
