/**
 * Generates exports/supabase-disk-audit.xlsx — per-table memory breakdown for the
 * Smart Analytics V2 Supabase project. Figures captured 2026-09-17 from
 * pg_total_relation_size / pg_stat_user_indexes.
 */
import ExcelJS from 'exceljs';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const CAPTURED = '2026-09-17';
const DB_TOTAL_BYTES = 112318655635;
const DB_TOTAL_GB = DB_TOTAL_BYTES / 1024 ** 3;

// name, kind, total_mb, data_mb, index_mb, toast_mb, est_rows
const TABLES = [
  ['smart_ga4_page_data', 'table', 29030.05, 18167.7, 10856.82, 0.48, 31627444],
  ['smart_ga4_bigq_raw', 'table', 24914.8, 19154.84, 5754.72, 0.01, 50593904],
  ['smart_final_data', 'table', 16756.59, 5392.23, 11362.12, 0.72, 9033876],
  ['smart_ga4_bigq_alltype_raw', 'table', 16690.49, 11774.22, 4912.91, 0.1, 44953784],
  ['smart_final_bigq_data', 'table', 13079.73, 4085.72, 8992.85, 0.02, 7930806],
  ['smart_ga4_page_data_backup', 'table', 2336.03, 2103.63, 231.79, 0.01, 0],
  ['smart_hoot_inventory_daily', 'table', 1970.52, 1781.41, 187.44, 1.18, 1204981],
  ['smart_ga4_bigq_daily_raw_data', 'table', 737.51, 467.13, 270.23, 0.01, 1302466],
  ['smart_master_db', 'table', 316.43, 214.49, 101.85, 0.01, 341643],
  ['smart_scrap_inventory_daily', 'table', 275.34, 182.2, 34.08, 59.0, 268749],
  ['smart_scrap_inventory', 'table', 222.73, 153.87, 27.9, 40.91, 190477],
  ['ga4_raw_metrics', 'table', 206.58, 126.01, 80.51, 0.01, 316362],
  ['smart_hoot_inventory', 'table', 196.59, 139.67, 56.6, 0.25, 79915],
  ['mv_ga4_channel_daily', 'materialized view', 56.78, 28.06, 28.68, 0.01, 341165],
  ['mv_ga4_vdp_channel_daily', 'materialized view', 49.94, 24.36, 25.54, 0.01, 382191],
  ['google_ads_metrics', 'table', 47.58, 39.27, 8.27, 0.01, 144289],
  ['smart_campaign_history', 'table', 45.87, 32.27, 13.55, 0.01, 125246],
  ['smart_ga4_page_ps_data', 'table', 31.34, 23.53, 7.77, 0.01, 15515],
  ['google_ads_auction_master', 'table', 26.25, 11.8, 14.41, 0.01, 60285],
  ['ga4_metrics', 'table', 24.55, 14.23, 10.28, 0.01, 64545],
  ['smart_hoot_inventory_live', 'table', 23.91, 21.65, 2.23, 0.01, 14961],
  ['whatconverts_leads', 'table', 18.89, 16.89, 1.59, 0.38, 20637],
  ['smart_search_term', 'table', 17.44, 8.24, 9.16, 0.01, 34800],
  ['mv_ga4_channel_monthly', 'materialized view', 6.31, 2.8, 3.47, 0.01, 36331],
  ['smart_user_login_sts', 'table', 4.51, 3.12, 1.35, 0.01, 7357],
  ['ga4_compare_vdp_channel_daily', 'table', 3.84, 1.62, 2.19, 0.01, 24320],
  ['mv_ga4_vdp_channel_monthly', 'materialized view', 2.75, 1.25, 1.46, 0.01, 18924],
  ['mv_ga4_channel_yearly', 'materialized view', 1.96, 0.9, 1.02, 0.01, 9490],
  ['smart_campaign', 'table', 1.13, 0.52, 0.57, 0.01, 1954],
  ['smart_custom_unknown_fillers', 'table', 1.03, 0.31, 0.68, 0.01, 2742],
  ['ga4_vdp_channel_monthly', 'table', 0.64, 0.28, 0.32, 0.01, 3510],
  ['mv_ga4_vdp_channel_yearly', 'materialized view', 0.62, 0.27, 0.31, 0.01, 3490],
  ['smart_ga4_day_complete', 'table', 0.58, 0.42, 0.12, 0.01, 1738],
  ['smart_unknown_vdp_links', 'table', 0.54, 0.29, 0.22, 0.01, 983],
  ['campaign_sync_queue', 'table', 0.46, 0.23, 0.19, 0.01, 1186],
  ['smart_ad', 'table', 0.32, 0.09, 0.2, 0.01, 232],
  ['smart_exception_data', 'table', 0.31, 0.15, 0.13, 0.01, 208],
  ['generated_reports', 'table', 0.28, 0.2, 0.05, 0.01, 335],
  ['smart_models', 'table', 0.28, 0.07, 0.18, 0.01, 884],
  ['smart_source_mapping_rules', 'table', 0.26, 0.03, 0.19, 0.01, 144],
  ['smart_keyword', 'table', 0.24, 0.05, 0.16, 0.01, 174],
  ['smart_ad_group', 'table', 0.23, 0.06, 0.14, 0.01, 290],
  ['smart_vdp_logic_2', 'table', 0.22, 0.05, 0.13, 0.01, 100],
  ['automation_logs', 'table', 0.21, 0.11, 0.07, 0.01, 390],
  ['smart_vdp_logic', 'table', 0.19, 0.04, 0.11, 0.01, 97],
  ['smart_dealer_locations', 'table', 0.16, 0.05, 0.07, 0.01, 116],
  ['smart_ga4_config', 'table', 0.13, 0.04, 0.05, 0.01, 107],
  ['smart_inventory_email_log', 'table', 0.12, 0.05, 0.03, 0.01, 158],
  ['google_ads_accounts', 'table', 0.12, 0.05, 0.03, 0.01, 117],
  ['smart_make', 'table', 0.11, 0.02, 0.06, 0.01, 120],
  ['smart_hoot_config', 'table', 0.09, 0.04, 0.02, 0.01, 98],
  ['smart_scrap_inventory_daily_log', 'table', 0.06, 0.01, 0.02, 0.01, 48],
  ['smart_source_mapping_channels', 'table', 0.06, 0.01, 0.02, 0.01, 9],
  ['smart_hoot_inventory_live_log', 'table', 0.06, 0.02, 0.02, 0.01, 117],
  ['smart_hoot_inventory_daily_log', 'table', 0.06, 0.01, 0.02, 0.01, 46],
  ['smart_user_roles', 'table', 0.06, 0.01, 0.05, 0.01, null],
  ['smart_user_reports', 'table', 0.05, 0.01, 0.03, 0.01, null],
  ['smart_user_dealers', 'table', 0.04, 0.01, 0.03, 0.0, null],
  ['dealers', 'table', 0.04, 0.0, 0.03, 0.01, null],
  ['smart_inventory_email_config', 'table', 0.03, 0.01, 0.02, 0.01, null],
  ['smart_roles', 'table', 0.03, 0.01, 0.02, 0.01, null],
  ['smart_google_ads_sync_state', 'table', 0.03, 0.01, 0.02, 0.01, 1],
  ['smart_reports', 'table', 0.03, 0.01, 0.02, 0.01, null],
  ['smart_scrap_day_complete', 'table', 0.03, 0.0, 0.02, 0.01, null],
];

// table, index, size_mb, lifetime_scans, verdict
const INDEXES = [
  ['smart_final_data', 'idx_sfd_join_lookup', 1779, 0, 'DUPLICATE of idx_final_data_client_date_path — drop'],
  ['smart_final_data', 'idx_final_data_client_date_path', 1779, 0, 'Keep one of the pair'],
  ['smart_final_bigq_data', 'idx_sfbd_join_lookup', 1603, 0, 'DUPLICATE (1 of 3 identical) — drop'],
  ['smart_final_bigq_data', 'idx_sfbd_join', 1603, 0, 'DUPLICATE (1 of 3 identical) — drop'],
  ['smart_final_bigq_data', 'idx_sfbd_client_date_path', 1603, 0, 'Keep one of the three'],
  ['smart_final_data', 'idx_smart_final_data_client_date_type_fill', 1596, 20, 'Low use — review'],
  ['smart_ga4_bigq_alltype_raw', 'idx_ga4_alltype_raw_profile_id', 1415, 0, 'Goes with frozen table'],
  ['smart_ga4_bigq_alltype_raw', 'idx_ga4_alltype_raw_profile_date_id', 1415, 0, 'Goes with frozen table'],
  ['smart_final_data', 'idx_final_data_filters', 1083, 19, 'Low use — review'],
  ['smart_final_bigq_data', 'idx_sfbd_filters', 1079, 0, 'Never scanned — drop'],
  ['smart_ga4_page_data', 'idx_ga4_page_data_client_date_channel', 1022, 2, 'Low use — review'],
  ['smart_ga4_bigq_alltype_raw', 'idx_smart_ga4_alltype_profile_date', 427, 1, 'Goes with frozen table'],
  ['smart_ga4_bigq_raw', 'idx_smart_ga4_profile_id', 373, 15, 'Low use — review'],
  ['smart_ga4_bigq_alltype_raw', 'idx_smart_ga4_alltype_profile_id', 331, 7, 'Goes with frozen table'],
  ['smart_ga4_bigq_alltype_raw', 'idx_smart_ga4_alltype_date', 320, 2, 'Goes with frozen table'],
  ['smart_ga4_page_data', 'idx_ga4_page_channel', 270, 0, 'Never scanned — drop'],
  ['smart_final_data', 'idx_sfd_inv_url', 217, 0, 'Never scanned — drop'],
  ['smart_final_bigq_data', 'idx_sfbd_page_path', 191, 0, 'Never scanned — drop'],
  ['smart_final_bigq_data', 'idx_sfbd_inv_url', 181, 0, 'Never scanned — drop'],
  ['smart_final_bigq_data', 'idx_sfbd_client_date_make', 138, 0, 'Never scanned — drop'],
  ['smart_final_bigq_data', 'idx_sfbd_client_date_year', 133, 0, 'Never scanned — drop'],
  ['smart_final_bigq_data', 'idx_sfbd_account_name', 127, 0, 'Never scanned — drop'],
  ['smart_final_bigq_data', 'idx_sfbd_vdp_true', 121, 0, 'Never scanned — drop'],
  ['smart_final_bigq_data', 'idx_sfbd_dealer_date_loc', 108, 0, 'Never scanned — drop'],
  ['smart_final_data', 'idx_sfd_vdp_true', 103, 0, 'Never scanned — drop'],
];

// action, frees_gb, risk, evidence
const ACTIONS = [
  ['Drop table smart_ga4_page_data_backup', 2.3, 'None', '0 rows, 0 inserts ever, yet 2,336 MB allocated. Truncated backup never reclaimed.'],
  ['Drop 2 of 3 identical indexes on smart_final_bigq_data', 3.2, 'Low', 'idx_sfbd_join, idx_sfbd_join_lookup, idx_sfbd_client_date_path are byte-identical btree (client_id, report_date, page_path).'],
  ['Drop 1 of 2 identical indexes on smart_final_data', 1.7, 'Low', 'idx_sfd_join_lookup duplicates idx_final_data_client_date_path exactly. Both 0 scans.'],
  ['Drop 11 remaining never-scanned indexes >100 MB', 2.6, 'Low', 'All non-unique, 0 lifetime scans, mostly on smart_final_bigq_data.'],
  ['Archive/drop smart_ga4_bigq_alltype_raw', 16.0, 'Medium', 'Newest row 2025-12-31 (frozen 9 months). Only 12 index scans in table lifetime.'],
];

const CHURN = [
  ['smart_ga4_page_data', 74872371, 19091093, 830760, 2.6, '2026-09-17 04:41'],
  ['smart_final_data', 355481, 3741600, 317986, 3.5, '2026-09-17 02:51'],
  ['smart_ga4_bigq_raw', 0, 155000, 160229, 0.3, '2026-09-08 08:56'],
  ['mv_ga4_channel_daily', 0, 32168, 45902, 13.3, 'never'],
  ['smart_scrap_inventory', 26773, 0, 35594, 18.7, 'never'],
  ['smart_campaign_history', 29718, 1760, 11115, 8.8, '2026-09-14 00:30'],
];

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } };
const RED = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE4E4' } };
const AMBER = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
const GREEN = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } };

function styleHeader(row) {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  row.fill = HEADER_FILL;
  row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  row.height = 30;
}

const wb = new ExcelJS.Workbook();
wb.creator = 'Smart Analytics — Supabase disk audit';
wb.created = new Date();

/* ---------------------------------------------------------- Sheet 1: Summary */
const s1 = wb.addWorksheet('Summary', { views: [{ showGridLines: false }] });
s1.columns = [{ width: 46 }, { width: 22 }, { width: 62 }];

s1.addRow(['Supabase disk audit — Smart Analytics V2']).font = { bold: true, size: 16 };
s1.addRow([`Project rllwmeqingvuohyctddg · Postgres 17.6 · ap-northeast-1 · captured ${CAPTURED}`]).font = {
  italic: true,
  color: { argb: 'FF666666' },
};
s1.addRow([]);

const sumHeader = s1.addRow(['Metric', 'Value', 'Note']);
styleHeader(sumHeader);

const totalIdx = TABLES.reduce((s, t) => s + t[4], 0);
const totalData = TABLES.reduce((s, t) => s + t[3], 0);
const top5 = TABLES.slice(0, 5).reduce((s, t) => s + t[2], 0);
const reclaim = ACTIONS.reduce((s, a) => s + a[1], 0);
const safeReclaim = ACTIONS.filter((a) => a[2] !== 'Medium').reduce((s, a) => s + a[1], 0);

const summaryRows = [
  ['Total database size', `${DB_TOTAL_GB.toFixed(1)} GB`, 'pg_database_size — this is the billed figure'],
  ['Tables counted', TABLES.length, 'All tables + materialized views in schema "public"'],
  ['Table data (heap)', `${(totalData / 1024).toFixed(1)} GB`, 'Actual row storage'],
  ['Index overhead', `${(totalIdx / 1024).toFixed(1)} GB`, 'Roughly 40% of the database is indexes'],
  ['Top 5 tables', `${(top5 / 1024).toFixed(1)} GB`, '93% of the database — everything else is noise'],
  ['Supabase Storage buckets', '198 MB', '37 files — negligible, not the problem'],
  ['Reclaimable (low/no risk)', `${safeReclaim.toFixed(1)} GB`, 'Empty backup table + duplicate/unused indexes'],
  ['Reclaimable (total incl. archive)', `${reclaim.toFixed(1)} GB`, `~${((reclaim / DB_TOTAL_GB) * 100).toFixed(0)}% of the database`],
  ['Enterprise plan needed?', 'NO', 'No size cap is breached on Pro/Team. Disk bills per GB; Enterprise is for SLA/compliance, not storage.'],
];
summaryRows.forEach((r) => {
  const row = s1.addRow(r);
  row.getCell(1).font = { bold: true };
  row.getCell(3).alignment = { wrapText: true, vertical: 'top' };
  if (r[0] === 'Enterprise plan needed?') {
    row.getCell(2).font = { bold: true, color: { argb: 'FF107C10' }, size: 12 };
    row.fill = GREEN;
  }
});

s1.addRow([]);
const whyTitle = s1.addRow(['Why the disk keeps growing on its own']);
whyTitle.font = { bold: true, size: 12 };
[
  'Postgres never overwrites a row in place — every UPDATE and DELETE leaves a dead version behind.',
  'smart_ga4_page_data has absorbed 74.9M updates and 19.1M deletes (Step 2 re-stamping vdp_conditions, Step 3 rebuilding its window nightly).',
  'Autovacuum IS keeping up (ran 04:41 today, dead rows only 2.6%) — but vacuum only marks space reusable inside the file.',
  'Vacuum never returns space to the operating system, so the file never shrinks.',
  'Supabase auto-expands the disk past ~90% full, and an expanded disk never shrinks back.',
  'Result: the size you see is a high-water mark that only ratchets upward. That is the behaviour you noticed.',
].forEach((t) => {
  const r = s1.addRow([t]);
  s1.mergeCells(`A${r.number}:C${r.number}`);
  r.getCell(1).alignment = { wrapText: true, vertical: 'top' };
  r.height = 28;
});

/* ----------------------------------------------------- Sheet 2: Table memory */
const s2 = wb.addWorksheet('Table Memory', { views: [{ state: 'frozen', ySplit: 1 }] });
s2.columns = [
  { header: '#', key: 'n', width: 5 },
  { header: 'Table', key: 't', width: 34 },
  { header: 'Kind', key: 'k', width: 17 },
  { header: 'Total MB', key: 'tm', width: 12 },
  { header: 'Total GB', key: 'tg', width: 11 },
  { header: 'Data MB', key: 'dm', width: 12 },
  { header: 'Index MB', key: 'im', width: 12 },
  { header: 'TOAST MB', key: 'om', width: 12 },
  { header: 'Index:Data', key: 'ir', width: 12 },
  { header: 'Est. rows', key: 'r', width: 14 },
  { header: '% of DB', key: 'p', width: 10 },
];
styleHeader(s2.getRow(1));

TABLES.forEach((t, i) => {
  const [name, kind, totalMb, dataMb, indexMb, toastMb, rows] = t;
  const row = s2.addRow({
    n: i + 1,
    t: name,
    k: kind,
    tm: totalMb,
    tg: totalMb / 1024,
    dm: dataMb,
    im: indexMb,
    om: toastMb,
    ir: dataMb > 0 ? indexMb / dataMb : null,
    r: rows,
    p: totalMb / (DB_TOTAL_BYTES / 1048576),
  });
  row.getCell('tm').numFmt = '#,##0.00';
  row.getCell('tg').numFmt = '#,##0.00';
  row.getCell('dm').numFmt = '#,##0.00';
  row.getCell('im').numFmt = '#,##0.00';
  row.getCell('om').numFmt = '#,##0.00';
  row.getCell('ir').numFmt = '0.00"x"';
  row.getCell('r').numFmt = '#,##0';
  row.getCell('p').numFmt = '0.00%';

  if (i < 5) row.fill = RED;
  else if (totalMb > 500) row.fill = AMBER;
  if (name === 'smart_ga4_page_data_backup') {
    row.fill = AMBER;
    row.getCell('r').font = { bold: true, color: { argb: 'FFC00000' } };
  }
  if (dataMb > 100 && indexMb / dataMb > 1.5) {
    row.getCell('ir').font = { bold: true, color: { argb: 'FFC00000' } };
  }
});

const totalRow = s2.addRow({
  t: 'TOTAL (public schema)',
  tm: TABLES.reduce((s, t) => s + t[2], 0),
  tg: TABLES.reduce((s, t) => s + t[2], 0) / 1024,
  dm: totalData,
  im: totalIdx,
  r: TABLES.reduce((s, t) => s + (t[6] || 0), 0),
});
totalRow.font = { bold: true };
totalRow.border = { top: { style: 'double' } };
['tm', 'tg', 'dm', 'im'].forEach((c) => (totalRow.getCell(c).numFmt = '#,##0.00'));
totalRow.getCell('r').numFmt = '#,##0';

const dbRow = s2.addRow({ t: 'pg_database_size (incl. catalogs/WAL metadata)', tg: DB_TOTAL_GB });
dbRow.font = { bold: true, color: { argb: 'FF1F3864' } };
dbRow.getCell('tg').numFmt = '#,##0.00';

/* --------------------------------------------------- Sheet 3: Index waste */
const s3 = wb.addWorksheet('Index Waste', { views: [{ state: 'frozen', ySplit: 1 }] });
s3.columns = [
  { header: 'Table', key: 't', width: 30 },
  { header: 'Index', key: 'i', width: 44 },
  { header: 'Size MB', key: 's', width: 11 },
  { header: 'Lifetime scans', key: 'c', width: 15 },
  { header: 'Verdict', key: 'v', width: 58 },
];
styleHeader(s3.getRow(1));
INDEXES.forEach(([t, i, s, c, v]) => {
  const row = s3.addRow({ t, i, s, c, v });
  row.getCell('s').numFmt = '#,##0';
  row.getCell('v').alignment = { wrapText: true, vertical: 'top' };
  if (v.startsWith('DUPLICATE') || v.startsWith('Never')) row.fill = RED;
  else if (v.startsWith('Goes with')) row.fill = AMBER;
  if (c === 0) row.getCell('c').font = { bold: true, color: { argb: 'FFC00000' } };
});
const idxTotal = s3.addRow({
  t: 'TOTAL listed',
  s: INDEXES.reduce((a, b) => a + b[2], 0),
  v: 'Indexes >100 MB with fewer than 50 lifetime scans',
});
idxTotal.font = { bold: true };
idxTotal.border = { top: { style: 'double' } };
idxTotal.getCell('s').numFmt = '#,##0';

/* --------------------------------------------------- Sheet 4: Action plan */
const s4 = wb.addWorksheet('Action Plan');
s4.columns = [
  { header: 'Action', key: 'a', width: 52 },
  { header: 'Frees GB', key: 'g', width: 11 },
  { header: 'Risk', key: 'r', width: 10 },
  { header: 'Evidence', key: 'e', width: 78 },
];
styleHeader(s4.getRow(1));
ACTIONS.forEach(([a, g, r, e]) => {
  const row = s4.addRow({ a, g, r, e });
  row.getCell('g').numFmt = '#,##0.0';
  row.getCell('e').alignment = { wrapText: true, vertical: 'top' };
  row.height = 32;
  row.fill = r === 'None' ? GREEN : r === 'Low' ? AMBER : RED;
});
const actTotal = s4.addRow({ a: 'TOTAL RECLAIMABLE', g: reclaim, e: `${((reclaim / DB_TOTAL_GB) * 100).toFixed(0)}% of the 105 GB database` });
actTotal.font = { bold: true };
actTotal.border = { top: { style: 'double' } };
actTotal.getCell('g').numFmt = '#,##0.0';

s4.addRow([]);
const caveat = s4.addRow(['IMPORTANT CAVEATS']);
caveat.font = { bold: true, size: 12 };
[
  'DROP TABLE and DROP INDEX return space immediately. Shrinking a bloated table instead needs VACUUM FULL or pg_repack.',
  'VACUUM FULL takes an exclusive lock and needs free disk equal to the table size — schedule it in a maintenance window.',
  'Scan counts are lifetime totals: pg_stat_database.stats_reset is NULL for this project, so 0 genuinely means never used.',
  'Still confirm no monthly/quarterly report depends on an index before dropping it.',
  'Even after reclaiming, the provisioned disk will NOT shrink by itself — Supabase support must reduce it, otherwise you keep paying the high-water mark and simply gain headroom.',
].forEach((t) => {
  const r = s4.addRow([t]);
  s4.mergeCells(`A${r.number}:D${r.number}`);
  r.getCell(1).alignment = { wrapText: true, vertical: 'top' };
  r.height = 26;
});

/* ------------------------------------------------------ Sheet 5: Row churn */
const s5 = wb.addWorksheet('Row Churn');
s5.columns = [
  { header: 'Table', key: 't', width: 30 },
  { header: 'Lifetime updates', key: 'u', width: 17 },
  { header: 'Lifetime deletes', key: 'd', width: 17 },
  { header: 'Dead rows now', key: 'x', width: 15 },
  { header: 'Dead %', key: 'p', width: 10 },
  { header: 'Last autovacuum', key: 'v', width: 20 },
];
styleHeader(s5.getRow(1));
CHURN.forEach(([t, u, d, x, p, v]) => {
  const row = s5.addRow({ t, u, d, x, p: p / 100, v });
  ['u', 'd', 'x'].forEach((c) => (row.getCell(c).numFmt = '#,##0'));
  row.getCell('p').numFmt = '0.0%';
  if (p > 10) row.fill = AMBER;
  if (v === 'never') row.getCell('v').font = { bold: true, color: { argb: 'FFC00000' } };
});
s5.addRow([]);
const churnNote = s5.addRow([
  'This churn is the root cause of disk growth: 74.9M updates on smart_ga4_page_data each left a dead row version behind, inflating both heap and its 10.9 GB of indexes.',
]);
s5.mergeCells(`A${churnNote.number}:F${churnNote.number}`);
churnNote.getCell(1).alignment = { wrapText: true, vertical: 'top' };
churnNote.height = 32;

const outDir = path.resolve('exports');
mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'supabase-disk-audit.xlsx');
await wb.xlsx.writeFile(outFile);
console.log(`Wrote ${outFile}`);
console.log(`Sheets: Summary, Table Memory (${TABLES.length} rows), Index Waste (${INDEXES.length}), Action Plan, Row Churn`);
