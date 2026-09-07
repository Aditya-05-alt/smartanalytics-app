import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

function loadEnv() {
  const raw = readFileSync(resolve('.env.local'), 'utf8');
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

const CLIENT_ID = '7231326744';
const FROM = '2026-08-01';
const TO = '2026-08-31';
const OUT = resolve('exports/xgrid_august_2026_vdp_urls.tsv');
const VDP_RE = /^\/(New|Used|Pre-Owned|Pre-owned)-Inventory-/i;

async function main() {
  const env = loadEnv();
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const pageSize = 1000;
  let from = 0;
  const byUrl = new Map();

  for (;;) {
    const { data, error } = await sb
      .from('smart_ga4_page_data')
      .select('page_path, views')
      .eq('client_id', CLIENT_ID)
      .gte('report_date', FROM)
      .lte('report_date', TO)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data?.length) break;

    for (const row of data) {
      const page_path = String(row.page_path || '').split('?')[0];
      if (!VDP_RE.test(page_path)) continue;
      const url = `https://www.xgridcampers.com${page_path}`;
      const cur = byUrl.get(url) || { views: 0, rows: 0, page_path };
      cur.views += Number(row.views || 0);
      cur.rows += 1;
      byUrl.set(url, cur);
    }

    if (data.length < pageSize) break;
    from += pageSize;
  }

  const rows = [...byUrl.entries()]
    .map(([url, v]) => ({ url, ...v }))
    .sort((a, b) => b.views - a.views || a.url.localeCompare(b.url));

  mkdirSync(resolve('exports'), { recursive: true });
  writeFileSync(
    OUT,
    [
      'views\trows\tpage_path\turl',
      ...rows.map((r) => [r.views, r.rows, r.page_path, r.url].join('\t')),
    ].join('\n') + '\n'
  );

  console.log(`urls=${rows.length} views=${rows.reduce((s, r) => s + r.views, 0)}`);
  console.log(OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
