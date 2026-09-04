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

const env = loadEnvLocal();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Missing Supabase URL or service role key');

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const rows = JSON.parse(
  fs.readFileSync('exports/interact_rv_make_model_type_2026.json', 'utf8'),
).map((r) => ({
  cms: 'Interact RV',
  make: r.make,
  model: r.model,
  type: r.type,
}));

const batchSize = 200;
let upserted = 0;
for (let i = 0; i < rows.length; i += batchSize) {
  const chunk = rows.slice(i, i + batchSize);
  const { error } = await supabase
    .from('smart_custom_unknown_fillers')
    .upsert(chunk, { onConflict: 'cms,make,model,type' });
  if (error) {
    console.error(error);
    process.exit(1);
  }
  upserted += chunk.length;
  console.log(`upserted ${upserted}/${rows.length}`);
}

const { count, error: countErr } = await supabase
  .from('smart_custom_unknown_fillers')
  .select('*', { count: 'exact', head: true })
  .eq('cms', 'Interact RV');
if (countErr) throw countErr;

const { data: sample, error: sampleErr } = await supabase
  .from('smart_custom_unknown_fillers')
  .select('cms, make, model, type')
  .eq('cms', 'Interact RV')
  .eq('make', 'Forest River Rv')
  .ilike('model', '%Wolf Pup%')
  .order('model');
if (sampleErr) throw sampleErr;

console.log(JSON.stringify({ count, sample }, null, 2));
