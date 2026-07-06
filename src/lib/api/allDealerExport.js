import {
  compareEntryForDealer,
  compareLookupFromRows,
  sliceMapForRow,
} from '@/lib/api/allDealerChannelMatrix';
import { pctChange } from '@/lib/overview/comparePeriod';

const TAB_SHEET_NAME = {
  vdp: 'VDP',
  all: 'All Pages',
};

const HEADER_FILL = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFC8E87A' },
};

/** Light green — Dealers + Total Views columns */
const DEALER_TOTAL_FILL = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFD4E8A8' },
};

/** Same family, slightly lighter — channel columns */
const CHANNEL_FILL = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFE8F4D9' },
};

function slugPart(value) {
  return String(value || 'export')
    .replace(/[^\w.-]+/g, '_')
    .slice(0, 48);
}

function formatMom(current, previous) {
  const pct = pctChange(current, previous);
  return `${pct > 0 ? '+' : ''}${pct}%`;
}

function buildHeaders(columns, showCompare, currentLabel, compareLabel) {
  if (!showCompare) {
    return ['Dealers', 'Total Views', ...columns];
  }

  const headers = [
    'Dealers',
    `Total Views (${currentLabel})`,
    `Total Views (${compareLabel})`,
    'Total Views (MoM)',
  ];

  for (const col of columns) {
    headers.push(`${col} (${currentLabel})`);
    headers.push(`${col} (${compareLabel})`);
    headers.push(`${col} (MoM)`);
  }

  return headers;
}

function buildDataRow(row, columns, showCompare, compareEntry) {
  const sliceMap = sliceMapForRow(row);
  const dealerName = row.dealer?.name || 'Unnamed dealer';

  if (row.error) {
    const empty = showCompare
      ? ['—', '—', '—', ...columns.flatMap(() => ['—', '—', '—'])]
      : ['—', ...columns.map(() => '—')];
    return [dealerName, ...empty];
  }

  if (!showCompare) {
    return [
      dealerName,
      Number(row.total) || 0,
      ...columns.map((col) => Number(sliceMap.get(col)?.value) || 0),
    ];
  }

  const compareTotal = Number(compareEntry?.total) || 0;
  const data = [
    dealerName,
    Number(row.total) || 0,
    compareTotal,
    formatMom(row.total, compareTotal),
  ];

  for (const col of columns) {
    const cur = Number(sliceMap.get(col)?.value) || 0;
    const cmp = Number(compareEntry?.channels?.get(col)?.value) || 0;
    data.push(cur, cmp, formatMom(cur, cmp));
  }

  return data;
}

function dealerTotalColumnCount(showCompare) {
  return showCompare ? 4 : 2;
}

function styleSheet(sheet, headers, showCompare, rowCount) {
  const dealerTotalCols = dealerTotalColumnCount(showCompare);
  const headerRow = sheet.getRow(1);

  headers.forEach((_, idx) => {
    const cell = headerRow.getCell(idx + 1);
    cell.font = { bold: true };
    cell.fill = HEADER_FILL;
  });

  for (let rowNumber = 2; rowNumber <= rowCount + 1; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    for (let colNumber = 1; colNumber <= headers.length; colNumber += 1) {
      const cell = row.getCell(colNumber);
      cell.font = { bold: true };
      cell.fill = colNumber <= dealerTotalCols ? DEALER_TOTAL_FILL : CHANNEL_FILL;
    }
  }

  sheet.getColumn(1).width = 28;
  sheet.getColumn(2).width = 14;

  for (let c = 2; c <= headers.length; c += 1) {
    const col = sheet.getColumn(c);
    if (c > 1) col.width = Math.min(18, Math.max(12, col.width || 12));
    const header = headers[c - 1] || '';
    if (!header.includes('MoM')) {
      col.numFmt = '#,##0';
    }
  }
}

function buildWorkbookRows(matrixRows, compareRows, columns, showCompare, labels) {
  const compareByDealer = compareLookupFromRows(compareRows);
  const headers = buildHeaders(
    columns,
    showCompare,
    labels.currentPeriodLabel,
    labels.comparePeriodLabel,
  );

  const dataRows = (matrixRows || []).map((row) => {
    const compareEntry = showCompare
      ? compareEntryForDealer(compareByDealer, row.dealer)
      : null;
    return buildDataRow(row, columns, showCompare, compareEntry);
  });

  return { headers, dataRows };
}

/**
 * Build XLSX from matrix data already loaded on the frontend (no API re-fetch).
 */
export async function downloadAllDealerChannelXlsx({
  matrixRows,
  compareMatrixRows = [],
  columns = [],
  from,
  to,
  tab = 'all',
  compareEnabled = false,
  compareFrom,
  compareTo,
  currentPeriodLabel = 'Current',
  comparePeriodLabel = 'Compare',
}) {
  if (!matrixRows?.length || !columns?.length || !from || !to) {
    throw new Error('Table data is not ready yet — wait for loading to finish.');
  }

  const fromIso = String(from).slice(0, 10);
  const toIso = String(to).slice(0, 10);
  const showCompare = Boolean(compareEnabled && compareFrom && compareTo);

  // Yield so "Preparing…" can paint before Excel work.
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

  const { headers, dataRows } = buildWorkbookRows(
    matrixRows,
    compareMatrixRows,
    columns,
    showCompare,
    { currentPeriodLabel, comparePeriodLabel },
  );

  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const sheetName = TAB_SHEET_NAME[tab] || 'All Pages';
  const sheet = workbook.addWorksheet(sheetName.slice(0, 31));

  sheet.addRow(headers);
  if (dataRows.length) {
    sheet.addRows(dataRows);
  }

  styleSheet(sheet, headers, showCompare, dataRows.length);

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

  const tabSlug = slugPart(tab === 'vdp' ? 'vdp' : 'all-pages');
  const rangeSlug = showCompare
    ? `${fromIso}_to_${toIso}_vs_${String(compareFrom).slice(0, 10)}_to_${String(compareTo).slice(0, 10)}`
    : `${fromIso}_to_${toIso}`;
  const filename = `all-dealers_${tabSlug}_${rangeSlug}.xlsx`;

  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);

  return {
    filename,
    dealerCount: matrixRows.length,
  };
}
