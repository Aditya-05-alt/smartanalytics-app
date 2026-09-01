import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const root = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(root, '..', '.env.local');
const env = Object.fromEntries(
  fs
    .readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    }),
);

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const clientId = process.argv[2] || '5152307309';
const daysBack = Number(process.argv[3] || 5);
const t0 = Date.now();
const { data, error } = await sb.rpc('build_smart_final_data_scrap', {
  p_client_id: clientId,
  p_days_back: daysBack,
  p_date_from: null,
  p_date_to: null,
});
console.log(JSON.stringify({ ms: Date.now() - t0, error: error?.message || null, data }, null, 2));
if (error) process.exit(1);
