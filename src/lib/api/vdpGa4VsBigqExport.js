const STATUS_LABELS = {
  matched: 'Matched',
  missing_from_report: 'Missing from report',
  ga4_only: 'GA4 only',
  bigq_only: 'BigQ only',
  other: 'Other',
};

function fmtPctExport(n) {
  if (n == null || Number.isNaN(Number(n))) return '';
  const v = Number(n);
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(2)}%`;
}

/**
 * Download GA4 vs BigQuery all-dealer compare as XLSX.
 */
export async function downloadGa4BigqCompareXlsx({ rows, meta }) {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'SmartAnalytics';
  const sheet = workbook.addWorksheet('GA4 vs BigQ');

  const fromIso = meta?.from || '';
  const toIso = meta?.to || '';
  const capIso = meta?.bigqCapTo || '';

  sheet.addRow(['GA4 vs BigQuery VDP Compare (all dealers)']);
  sheet.addRow(['Date range', fromIso && toIso ? `${fromIso} → ${toIso}` : '']);
  sheet.addRow(['BigQuery data through', capIso || 'today − 2']);
  sheet.addRow(['Exported', new Date().toISOString().slice(0, 19).replace('T', ' ')]);
  sheet.addRow([]);

  const headerRow = sheet.addRow([
    'Dealer',
    'Profile ID',
    'Client ID',
    'Status',
    'GA4 VDP views',
    'BigQ VDP views',
    'Delta (BigQ − GA4)',
    'Delta %',
  ]);
  headerRow.font = { bold: true };

  for (const row of rows || []) {
    sheet.addRow([
      row.accountName || '',
      row.propertyId || '',
      row.clientId || '',
      STATUS_LABELS[row.matchStatus] || row.matchStatus || '',
      Number(row.ga4VdpViews) || 0,
      Number(row.bigqVdpViews) || 0,
      Number(row.deltaViews) || 0,
      fmtPctExport(row.deltaPct),
    ]);
  }

  if (meta?.ga4Total != null || meta?.bigqTotal != null) {
    const totalRow = sheet.addRow([
      'Total',
      '',
      '',
      '',
      Number(meta.ga4Total) || 0,
      Number(meta.bigqTotal) || 0,
      Number(meta.deltaTotal) || 0,
      fmtPctExport(meta.deltaPctTotal),
    ]);
    totalRow.font = { bold: true };
  }

  sheet.columns = [
    { width: 36 },
    { width: 14 },
    { width: 16 },
    { width: 20 },
    { width: 16 },
    { width: 16 },
    { width: 18 },
    { width: 12 },
  ];

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const rangeSlug =
    fromIso && toIso ? `${fromIso}_to_${toIso}` : 'export';
  const filename = `ga4-bigq-compare_${rangeSlug}.xlsx`;

  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);

  return { filename, rowCount: rows?.length || 0 };
}
