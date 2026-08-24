import { fetchCampaignViews } from '@/lib/api/campaignViews';

function slugPart(value) {
  return String(value || 'export')
    .replace(/[^\w.-]+/g, '_')
    .slice(0, 48);
}

function toExcelDate(value) {
  if (!value) return null;
  const iso = String(value).slice(0, 10);
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d);
}

const HEADER_FILL = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFC8E87A' },
};
const DATE_FILL = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFE8F4D9' },
};
const TOTAL_FILL = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFD4E8A8' },
};

function aggregateByCampaign(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const name = String(row.campaign || '(not set)');
    const prev = map.get(name) || { campaign: name, views: 0 };
    prev.views += Number(row.views) || 0;
    map.set(name, prev);
  }
  const sorted = [...map.values()].sort((a, b) => b.views - a.views);
  const total = sorted.reduce((s, r) => s + r.views, 0);
  return sorted.map((r) => ({
    ...r,
    pct: total > 0 ? Math.round((r.views / total) * 10000) / 100 : 0,
  }));
}

function buildMatrix(campaigns, daily, cells) {
  const cellMap = new Map();
  const campaignTotals = new Map();

  for (const cell of cells || []) {
    const report_date = String(cell.report_date || '').split('T')[0];
    const campaign = String(cell.campaign || '').trim();
    if (!report_date || !campaign) continue;
    const views = Number(cell.views) || 0;
    const key = `${report_date}||${campaign}`;
    cellMap.set(key, (cellMap.get(key) || 0) + views);
    campaignTotals.set(campaign, (campaignTotals.get(campaign) || 0) + views);
  }

  let campaignCols = [...campaignTotals.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name);

  if (!campaignCols.length) {
    campaignCols = aggregateByCampaign(campaigns).map((c) => c.campaign).filter(Boolean);
  }

  const dateSet = new Set();
  for (const d of daily || []) {
    const report_date = String(d.report_date || '').split('T')[0];
    if (report_date) dateSet.add(report_date);
  }
  for (const key of cellMap.keys()) {
    dateSet.add(key.split('||')[0]);
  }

  const dates = [...dateSet].sort((a, b) => a.localeCompare(b));
  const rows = dates.map((report_date) => {
    const values = {};
    let rowTotal = 0;
    for (const campaign of campaignCols) {
      const v = cellMap.get(`${report_date}||${campaign}`) || 0;
      values[campaign] = v;
      rowTotal += v;
    }
    return { report_date, values, rowTotal };
  });

  const colTotals = {};
  let grandTotal = 0;
  for (const campaign of campaignCols) {
    const sum = rows.reduce((s, r) => s + (r.values[campaign] || 0), 0);
    colTotals[campaign] = sum;
    grandTotal += sum;
  }

  return { campaignCols, rows, colTotals, grandTotal };
}

function styleHeaderRow(sheet, colCount) {
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  for (let i = 1; i <= colCount; i += 1) {
    headerRow.getCell(i).fill = HEADER_FILL;
  }
}

function styleTotalRow(sheet, rowNum, colCount) {
  const totalRow = sheet.getRow(rowNum);
  totalRow.font = { bold: true };
  for (let i = 1; i <= colCount; i += 1) {
    totalRow.getCell(i).fill = TOTAL_FILL;
  }
}

/** Build and download WA campaign views XLSX (detail, daily, date × campaign). */
export async function downloadCampaignsXlsx({
  clientId,
  from,
  to,
  pageType = 'ALL',
  dealerName,
}) {
  if (!clientId || !from || !to) {
    throw new Error('Select a dealer and date range first.');
  }

  const fromIso = String(from).slice(0, 10);
  const toIso = String(to).slice(0, 10);

  const data = await fetchCampaignViews({
    clientId: String(clientId).trim(),
    from: fromIso,
    to: toIso,
    pageType,
  });

  const campaigns = aggregateByCampaign(data.campaigns);
  const daily = (data.daily || [])
    .map((r) => ({
      report_date: String(r.report_date || '').split('T')[0],
      views: Number(r.views) || 0,
    }))
    .filter((r) => r.report_date)
    .sort((a, b) => a.report_date.localeCompare(b.report_date));

  const matrix = buildMatrix(data.campaigns, daily, data.cells);

  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();

  // Sheet 1 — Campaign detail
  const detailSheet = workbook.addWorksheet('Campaign Detail');
  detailSheet.addRow(['Session Campaign', 'Page Views', '% of Total']);
  styleHeaderRow(detailSheet, 3);

  let detailTotal = 0;
  for (const row of campaigns) {
    detailTotal += row.views;
    detailSheet.addRow([row.campaign, row.views, row.pct / 100]);
  }
  const detailTotalRow = detailSheet.rowCount + 1;
  detailSheet.addRow(['Total', detailTotal, detailTotal > 0 ? 1 : 0]);
  styleTotalRow(detailSheet, detailTotalRow, 3);

  detailSheet.getColumn(1).width = 48;
  detailSheet.getColumn(2).width = 14;
  detailSheet.getColumn(2).numFmt = '#,##0';
  detailSheet.getColumn(3).width = 14;
  detailSheet.getColumn(3).numFmt = '0.0%';

  // Sheet 2 — Daily totals
  const dailySheet = workbook.addWorksheet('Daily');
  dailySheet.addRow(['Date', 'Page Views']);
  styleHeaderRow(dailySheet, 2);

  let dailyTotal = 0;
  for (const row of daily) {
    dailyTotal += row.views;
    const dataRow = dailySheet.addRow([toExcelDate(row.report_date), row.views]);
    dataRow.getCell(1).fill = DATE_FILL;
  }
  const dailyTotalRow = dailySheet.rowCount + 1;
  dailySheet.addRow(['Total', dailyTotal]);
  styleTotalRow(dailySheet, dailyTotalRow, 2);

  dailySheet.getColumn(1).width = 14;
  dailySheet.getColumn(1).numFmt = 'yyyy-mm-dd';
  dailySheet.getColumn(2).width = 14;
  dailySheet.getColumn(2).numFmt = '#,##0';

  // Sheet 3 — Date × campaign matrix
  const matrixSheet = workbook.addWorksheet('Date x Campaign');
  const matrixHeaders = ['Date', 'Page Views', ...matrix.campaignCols];
  matrixSheet.addRow(matrixHeaders);
  styleHeaderRow(matrixSheet, matrixHeaders.length);

  for (const row of matrix.rows) {
    const dataRow = matrixSheet.addRow([
      toExcelDate(row.report_date),
      row.rowTotal,
      ...matrix.campaignCols.map((c) => row.values[c] || 0),
    ]);
    dataRow.getCell(1).fill = DATE_FILL;
  }

  const matrixTotalRowNum = matrixSheet.rowCount + 1;
  matrixSheet.addRow([
    'Total',
    matrix.grandTotal,
    ...matrix.campaignCols.map((c) => matrix.colTotals[c] || 0),
  ]);
  styleTotalRow(matrixSheet, matrixTotalRowNum, matrixHeaders.length);

  matrixSheet.getColumn(1).width = 14;
  matrixSheet.getColumn(1).numFmt = 'yyyy-mm-dd';
  matrixSheet.getColumn(2).width = 14;
  matrixSheet.getColumn(2).numFmt = '#,##0';
  for (let i = 3; i <= matrixHeaders.length; i += 1) {
    matrixSheet.getColumn(i).width = 18;
    matrixSheet.getColumn(i).numFmt = '#,##0';
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const dealerSlug = slugPart(dealerName);
  const pageSlug = pageType === 'VDP' ? 'vdp' : 'all';
  const filename = `campaigns_${dealerSlug}_${pageSlug}_${fromIso}_to_${toIso}.xlsx`;

  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);

  return {
    filename,
    counts: {
      campaigns: campaigns.length,
      daily: daily.length,
      matrixRows: matrix.rows.length,
    },
  };
}
