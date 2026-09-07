import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

function loadEnv() {
  const raw = readFileSync(resolve('.env.local'), 'utf8');
  const env = {};
  for (const line of raw.split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

const CLIENT_ID = '3454932870';
const FROM = '2026-08-01';
const TO = '2026-08-31';
const OUT = resolve('exports/fort_kent_august_2026_condition_other_urls.tsv');

async function main() {
  const env = loadEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Missing Supabase URL or service role key in .env.local');

  const sb = createClient(url, key, { auth: { persistSession: false } });
  const pageSize = 1000;
  let from = 0;
  const byPath = new Map();

  for (;;) {
    const { data, error } = await sb
      .from('smart_final_data')
      .select('page_path, views, inv_make, inv_model, inv_year, inv_type, inv_condition, vdp_conditions')
      .eq('client_id', CLIENT_ID)
      .gte('report_date', FROM)
      .lte('report_date', TO)
      .eq('vdp_conditions', true)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data?.length) break;

    for (const row of data) {
      if (String(row.inv_condition || '').trim() !== '') continue;
      const path = String(row.page_path || '').split('?')[0];
      if (!path) continue;
      const cur = byPath.get(path) || {
        views: 0,
        rows: 0,
        inv_make: row.inv_make || '',
        inv_model: row.inv_model || '',
        inv_year: row.inv_year || '',
        inv_type: row.inv_type || '',
      };
      cur.views += Number(row.views || 0);
      cur.rows += 1;
      if (!cur.inv_make && row.inv_make) cur.inv_make = row.inv_make;
      if (!cur.inv_model && row.inv_model) cur.inv_model = row.inv_model;
      if (!cur.inv_year && row.inv_year) cur.inv_year = row.inv_year;
      if (!cur.inv_type && row.inv_type) cur.inv_type = row.inv_type;
      byPath.set(path, cur);
    }

    if (data.length < pageSize) break;
    from += pageSize;
  }

  const rows = [...byPath.entries()]
    .map(([page_path, v]) => ({ page_path, ...v }))
    .sort((a, b) => b.views - a.views || a.page_path.localeCompare(b.page_path));

  mkdirSync(resolve('exports'), { recursive: true });
  const lines = [
    'views\trows\tinv_make\tinv_model\tinv_year\tinv_type\tpage_path',
    ...rows.map((r) =>
      [r.views, r.rows, r.inv_make, r.inv_model, r.inv_year, r.inv_type, r.page_path].join('\t')
    ),
  ];
  writeFileSync(OUT, lines.join('\n') + '\n');

  const totalViews = rows.reduce((s, r) => s + r.views, 0);
  console.log(`unique_paths=${rows.length} total_views=${totalViews} total_rows=${rows.reduce((s, r) => s + r.rows, 0)}`);
  console.log(OUT);
  console.log('--- top 20 ---');
  for (const r of rows.slice(0, 20)) {
    console.log(`${r.views}\t${r.page_path}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
