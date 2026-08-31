/**
 * VDP Month-over-Month report — all accounts, Aug 1–25 vs Jul 1–25.
 * Uses smart_ga4_page_data via get_ga4_channel_breakdown (vdp_conditions = TRUE).
 *
 * Usage: node scripts/generate-vdp-mom-report.mjs
 * Output: exports/vdp_mom_aug_vs_jul_2026.xlsx (+ .html + .pdf)
 */
import { createClient } from '@supabase/supabase-js';
import ExcelJS from 'exceljs';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const EXPORTS = join(ROOT, 'exports');

const AUG_FROM = '2026-08-01';
const AUG_TO = '2026-08-25';
const JUL_FROM = '2026-07-01';
const JUL_TO = '2026-07-25';
const CONCURRENCY = 8;

function loadEnv() {
  const envPath = resolve(ROOT, '.env.local');
  const raw = readFileSync(envPath, 'utf8');
  const env = {};
  for (const line of raw.split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) env[m[1].trim()] = m[2].trim();
  }
  return env;
}

function pctChange(current, previous) {
  const c = Number(current) || 0;
  const p = Number(previous) || 0;
  if (p === 0) return c === 0 ? 0 : null;
  return Math.round(((c - p) / p) * 100);
}

function formatDelta(current, previous) {
  const pct = pctChange(current, previous);
  if (pct === null) return '—';
  if (pct > 0) return `↑ ${pct}%`;
  if (pct < 0) return `↓ ${Math.abs(pct)}%`;
  return '0%';
}

function formatViews(n) {
  return (Number(n) || 0).toLocaleString('en-US');
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function summarizeChannels(rows) {
  let total = 0;
  let paidSearch = 0;
  for (const row of rows || []) {
    const views = Number(row.views) || 0;
    total += views;
    if (row.channel_bucket === 'Paid Search') paidSearch += views;
  }
  return { total, paidSearch };
}

async function fetchAccountName(supabase, clientId) {
  const { data } = await supabase
    .from('smart_ga4_page_data')
    .select('account_name')
    .eq('client_id', clientId)
    .gte('report_date', AUG_FROM)
    .lte('report_date', AUG_TO)
    .not('account_name', 'is', null)
    .limit(1)
    .maybeSingle();

  const name = data?.account_name?.trim();
  return name || null;
}

async function fetchChannelBreakdown(supabase, clientId, from, to) {
  const { data, error } = await supabase.rpc('get_ga4_channel_breakdown', {
    p_client_id: clientId,
    p_from: from,
    p_to: to,
    p_page_type: 'VDP',
  });
  if (error) throw new Error(`${clientId} ${from}–${to}: ${error.message}`);
  return data || [];
}

async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index;
      index += 1;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function fetchReportRows(supabase) {
  const { data: dealers, error } = await supabase
    .from('smart_hoot_config')
    .select('ga4_customer_id, customer_name')
    .eq('is_active', true)
    .not('ga4_customer_id', 'is', null)
    .order('customer_name');

  if (error) throw new Error(`Dealer list: ${error.message}`);

  const entries = (dealers || [])
    .map((d) => ({
      clientId: String(d.ga4_customer_id).trim(),
      fallbackName: d.customer_name?.trim() || '(not set)',
    }))
    .filter((d) => d.clientId);

  console.log(`Fetching VDP channel breakdown for ${entries.length} accounts…`);

  const rows = await mapPool(entries, CONCURRENCY, async (entry, idx) => {
    const [augRows, julRows, accountName] = await Promise.all([
      fetchChannelBreakdown(supabase, entry.clientId, AUG_FROM, AUG_TO),
      fetchChannelBreakdown(supabase, entry.clientId, JUL_FROM, JUL_TO),
      fetchAccountName(supabase, entry.clientId),
    ]);

    const aug = summarizeChannels(augRows);
    const jul = summarizeChannels(julRows);

    if ((idx + 1) % 10 === 0 || idx + 1 === entries.length) {
      process.stdout.write(`\r  ${idx + 1}/${entries.length} accounts`);
    }

    return {
      client_id: entry.clientId,
      account_name: accountName || entry.fallbackName,
      aug_total_vdp: aug.total,
      aug_paid_search_vdp: aug.paidSearch,
      jul_total_vdp: jul.total,
      jul_paid_search_vdp: jul.paidSearch,
    };
  });

  process.stdout.write('\n');
  return rows.sort((a, b) => a.account_name.localeCompare(b.account_name));
}

function enrichRows(rows) {
  return rows.map((r) => ({
    ...r,
    mom_total_vdp: formatDelta(r.aug_total_vdp, r.jul_total_vdp),
    mom_paid_search_vdp: formatDelta(r.aug_paid_search_vdp, r.jul_paid_search_vdp),
  }));
}

async function buildXlsx(rows, outPath) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'SmartAnalytics';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('VDP MoM');
  const headerFill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1A2332' },
  };
  const headerFont = { bold: true, color: { argb: 'FFE8F0FF' }, size: 10 };
  const subHeaderFont = { bold: true, color: { argb: 'FFCBD5E1' }, size: 9 };
  const border = {
    top: { style: 'thin', color: { argb: 'FF3A4A62' } },
    left: { style: 'thin', color: { argb: 'FF3A4A62' } },
    bottom: { style: 'thin', color: { argb: 'FF3A4A62' } },
    right: { style: 'thin', color: { argb: 'FF3A4A62' } },
  };

  sheet.mergeCells('A1:A2');
  sheet.mergeCells('B1:C1');
  sheet.mergeCells('D1:E1');
  sheet.mergeCells('F1:G1');

  const titles = [
    ['Account Name', 'Aug (1–25)', '', 'Jul (1–25)', '', 'MoM', ''],
    ['', 'Total VDP', 'Paid Search', 'Total VDP', 'Paid Search', 'Total VDP', 'Paid Search'],
  ];

  for (let r = 0; r < titles.length; r += 1) {
    const row = sheet.getRow(r + 1);
    titles[r].forEach((val, c) => {
      const cell = row.getCell(c + 1);
      cell.value = val;
      cell.fill = headerFill;
      cell.font = r === 0 ? headerFont : subHeaderFont;
      cell.alignment = {
        vertical: 'middle',
        horizontal: c === 0 ? 'left' : 'center',
        wrapText: true,
      };
      cell.border = border;
    });
    row.height = r === 0 ? 22 : 20;
  }

  sheet.getCell('A1').value = 'Account Name';

  let dataRow = 3;
  for (const r of rows) {
    const row = sheet.getRow(dataRow);
    const values = [
      r.account_name,
      Number(r.aug_total_vdp) || 0,
      Number(r.aug_paid_search_vdp) || 0,
      Number(r.jul_total_vdp) || 0,
      Number(r.jul_paid_search_vdp) || 0,
      r.mom_total_vdp,
      r.mom_paid_search_vdp,
    ];
    values.forEach((val, c) => {
      const cell = row.getCell(c + 1);
      cell.value = val;
      cell.border = border;
      cell.alignment = {
        vertical: 'middle',
        horizontal: c === 0 ? 'left' : 'right',
      };
      if (c > 0 && c < 5 && typeof val === 'number') cell.numFmt = '#,##0';
      if (c >= 5) {
        cell.font = {
          bold: true,
          color: {
            argb: String(val).startsWith('↑')
              ? 'FF22C55E'
              : String(val).startsWith('↓')
                ? 'FFEF4444'
                : 'FF94A3B8',
          },
        };
      }
    });
    dataRow += 1;
  }

  const totals = rows.reduce(
    (acc, r) => ({
      aug_total: acc.aug_total + (Number(r.aug_total_vdp) || 0),
      aug_paid: acc.aug_paid + (Number(r.aug_paid_search_vdp) || 0),
      jul_total: acc.jul_total + (Number(r.jul_total_vdp) || 0),
      jul_paid: acc.jul_paid + (Number(r.jul_paid_search_vdp) || 0),
    }),
    { aug_total: 0, aug_paid: 0, jul_total: 0, jul_paid: 0 },
  );

  const totalRow = sheet.getRow(dataRow);
  [
    'TOTAL',
    totals.aug_total,
    totals.aug_paid,
    totals.jul_total,
    totals.jul_paid,
    formatDelta(totals.aug_total, totals.jul_total),
    formatDelta(totals.aug_paid, totals.jul_paid),
  ].forEach((val, c) => {
    const cell = totalRow.getCell(c + 1);
    cell.value = val;
    cell.border = border;
    cell.font = { bold: true };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF2A3A52' },
    };
    cell.alignment = {
      vertical: 'middle',
      horizontal: c === 0 ? 'left' : 'right',
    };
    if (c > 0 && c < 5 && typeof val === 'number') cell.numFmt = '#,##0';
  });

  sheet.getColumn(1).width = 36;
  for (let c = 2; c <= 7; c += 1) sheet.getColumn(c).width = 16;
  sheet.views = [{ state: 'frozen', xSplit: 1, ySplit: 2 }];

  sheet.getCell('I1').value = 'Notes';
  sheet.getCell('I2').value =
    `Source: smart_ga4_page_data via get_ga4_channel_breakdown | VDP tab | Paid Search channel | MoM = Aug vs Jul (same 1–25 day span) | Generated ${new Date().toISOString()}`;

  await workbook.xlsx.writeFile(outPath);
}

function buildHtml(rows) {
  const bodyRows = rows.map((r) => `
    <tr>
      <td>${escHtml(r.account_name)}</td>
      <td class="num">${formatViews(r.aug_total_vdp)}</td>
      <td class="num">${formatViews(r.aug_paid_search_vdp)}</td>
      <td class="num">${formatViews(r.jul_total_vdp)}</td>
      <td class="num">${formatViews(r.jul_paid_search_vdp)}</td>
      <td class="delta ${String(r.mom_total_vdp).startsWith('↑') ? 'up' : String(r.mom_total_vdp).startsWith('↓') ? 'down' : ''}">${escHtml(r.mom_total_vdp)}</td>
      <td class="delta ${String(r.mom_paid_search_vdp).startsWith('↑') ? 'up' : String(r.mom_paid_search_vdp).startsWith('↓') ? 'down' : ''}">${escHtml(r.mom_paid_search_vdp)}</td>
    </tr>`).join('');

  const totals = rows.reduce(
    (acc, r) => ({
      aug_total: acc.aug_total + (Number(r.aug_total_vdp) || 0),
      aug_paid: acc.aug_paid + (Number(r.aug_paid_search_vdp) || 0),
      jul_total: acc.jul_total + (Number(r.jul_total_vdp) || 0),
      jul_paid: acc.jul_paid + (Number(r.jul_paid_search_vdp) || 0),
    }),
    { aug_total: 0, aug_paid: 0, jul_total: 0, jul_paid: 0 },
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>VDP MoM — Aug 1–25 vs Jul 1–25</title>
  <style>
    body { font-family: Segoe UI, Arial, sans-serif; font-size: 9pt; margin: 1.2cm; color: #111; }
    h1 { font-size: 16pt; margin: 0 0 4px; }
    p.meta { color: #555; margin: 0 0 16px; font-size: 8pt; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #cbd5e1; padding: 5px 7px; }
    th { background: #1a2332; color: #e8f0ff; font-weight: 600; text-align: center; }
    th.sub { background: #243044; font-size: 8pt; }
    td.num { text-align: right; font-variant-numeric: tabular-nums; }
    td.delta { text-align: right; font-weight: 600; }
    td.delta.up { color: #16a34a; }
    td.delta.down { color: #dc2626; }
    tr.total td { background: #eff6ff; font-weight: 700; }
    @media print { body { margin: 0.8cm; } thead { display: table-header-group; } }
  </style>
</head>
<body>
  <h1>VDP Month-over-Month — All Accounts</h1>
  <p class="meta">Aug 1–25, 2026 vs Jul 1–25, 2026 · smart_ga4_page_data · VDP (vdp_conditions) · Paid Search channel · MoM = aligned prior-month day span</p>
  <table>
    <thead>
      <tr>
        <th rowspan="2">Account Name</th>
        <th colspan="2">Aug (1–25)</th>
        <th colspan="2">Jul (1–25)</th>
        <th colspan="2">MoM</th>
      </tr>
      <tr>
        <th class="sub">Total VDP</th>
        <th class="sub">Paid Search</th>
        <th class="sub">Total VDP</th>
        <th class="sub">Paid Search</th>
        <th class="sub">Total VDP</th>
        <th class="sub">Paid Search</th>
      </tr>
    </thead>
    <tbody>
      ${bodyRows}
      <tr class="total">
        <td>TOTAL</td>
        <td class="num">${formatViews(totals.aug_total)}</td>
        <td class="num">${formatViews(totals.aug_paid)}</td>
        <td class="num">${formatViews(totals.jul_total)}</td>
        <td class="num">${formatViews(totals.jul_paid)}</td>
        <td class="delta">${escHtml(formatDelta(totals.aug_total, totals.jul_total))}</td>
        <td class="delta">${escHtml(formatDelta(totals.aug_paid, totals.jul_paid))}</td>
      </tr>
    </tbody>
  </table>
</body>
</html>`;
}

function writePdf(htmlPath, pdfPath) {
  const browsers = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ];
  const browser = browsers.find((p) => existsSync(p));
  if (!browser) return false;
  execSync(
    `"${browser}" --headless --disable-gpu --no-pdf-header-footer --print-to-pdf="${pdfPath}" "${htmlPath}"`,
    { stdio: 'inherit' },
  );
  return true;
}

async function main() {
  const env = loadEnv();
  const supabase = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );

  const rawRows = await fetchReportRows(supabase);
  const rows = enrichRows(rawRows);
  console.log(`Prepared ${rows.length} accounts.`);

  if (!existsSync(EXPORTS)) mkdirSync(EXPORTS, { recursive: true });

  const base = 'vdp_mom_aug_vs_jul_2026';
  const xlsxPath = join(EXPORTS, `${base}.xlsx`);
  const htmlPath = join(EXPORTS, `${base}.html`);
  const pdfPath = join(EXPORTS, `${base}.pdf`);
  const jsonPath = join(EXPORTS, `${base}.json`);

  writeFileSync(jsonPath, JSON.stringify({ generated_at: new Date().toISOString(), rows }, null, 2));

  await buildXlsx(rows, xlsxPath);
  console.log('Wrote', xlsxPath);

  writeFileSync(htmlPath, buildHtml(rows), 'utf8');
  console.log('Wrote', htmlPath);

  if (writePdf(htmlPath, pdfPath)) {
    console.log('Wrote', pdfPath);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
