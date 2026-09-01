import fs from 'fs';
import ExcelJS from 'exceljs';

const src =
  'C:/Users/adity/.cursor/projects/c-htmls-Smart-analytics-Main-smartanalytics-app/agent-tools/2463d124-38b2-47b3-8802-dbb901895138.txt';
const out = 'exports/peak_honda_june_2026_unknown_vs_vdp_logic_2.xlsx';

const outer = JSON.parse(fs.readFileSync(src, 'utf8'));
const m = String(outer.result).match(
  /<untrusted-data-[^>]+>\s*(\[[\s\S]*?\])\s*<\/untrusted-data-/
);
if (!m) throw new Error('Could not find untrusted-data JSON array');
const rows = JSON.parse(m[1]);

const yes = rows.filter((r) => r.matches_new_vdp_logic);
const no = rows.filter((r) => !r.matches_new_vdp_logic);
const sumViews = (arr) => arr.reduce((s, r) => s + Number(r.views || 0), 0);

const wb = new ExcelJS.Workbook();
wb.creator = 'smartanalytics';

const summary = wb.addWorksheet('Summary');
summary.columns = [
  { header: 'Metric', key: 'm', width: 40 },
  { header: 'Value', key: 'v', width: 90 },
];
summary.addRows([
  { m: 'Dealer', v: 'Peak Honda World (2721177227)' },
  { m: 'Period', v: 'June 2026 (2026-06-01 to 2026-06-30)' },
  {
    m: 'Source',
    v: 'smart_final_data unknown URLs (no inv_url / vdp_conditions not true)',
  },
  { m: 'Compared against', v: 'smart_vdp_logic_2.vdp_logic' },
  { m: 'New VDP regex', v: rows[0]?.new_vdp_logic || '' },
  { m: 'Unique unknown URLs', v: rows.length },
  { m: 'Would match new VDP logic (YES)', v: yes.length },
  { m: 'Would NOT match (NO)', v: no.length },
  { m: 'Total views (YES URLs)', v: sumViews(yes) },
  { m: 'Total views (NO URLs)', v: sumViews(no) },
]);
summary.getRow(1).font = { bold: true };

const ws = wb.addWorksheet('Unknown vs VDP Logic 2');
ws.columns = [
  { header: 'url', key: 'url', width: 90 },
  { header: 'page_path', key: 'page_path', width: 70 },
  { header: 'views', key: 'views', width: 10 },
  { header: 'days_seen', key: 'days_seen', width: 12 },
  { header: 'first_date', key: 'first_date', width: 12 },
  { header: 'last_date', key: 'last_date', width: 12 },
  { header: 'matches_new_vdp_logic', key: 'matches_new_vdp_logic', width: 22 },
  { header: 'analysis', key: 'analysis', width: 45 },
  { header: 'new_vdp_logic', key: 'new_vdp_logic', width: 70 },
];
ws.getRow(1).font = { bold: true };
ws.getRow(1).fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFE2E8F0' },
};

for (const r of rows) {
  const row = ws.addRow({
    url: r.url,
    page_path: r.page_path,
    views: Number(r.views) || 0,
    days_seen: Number(r.days_seen) || 0,
    first_date: r.first_date,
    last_date: r.last_date,
    matches_new_vdp_logic: r.matches_new_vdp_logic ? 'YES' : 'NO',
    analysis: r.analysis,
    new_vdp_logic: r.new_vdp_logic,
  });
  row.getCell('matches_new_vdp_logic').fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: r.matches_new_vdp_logic ? 'FFBBF7D0' : 'FFFECACA' },
  };
}

ws.autoFilter = { from: 'A1', to: 'I1' };
ws.views = [{ state: 'frozen', ySplit: 1 }];

await wb.xlsx.writeFile(out);
console.log(
  JSON.stringify(
    {
      out,
      total: rows.length,
      yes: yes.length,
      no: no.length,
      views_yes: sumViews(yes),
      views_no: sumViews(no),
    },
    null,
    2
  )
);
