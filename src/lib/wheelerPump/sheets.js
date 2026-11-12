'use client';

import { mkey, mv, norm, qv } from './calc';

/** RFC 4180-style CSV/TSV → array of rows (arrays of strings). */
function parseDelimited(text, sep) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((v) => String(v).trim() !== ''));
}

/** Header row + data rows → objects keyed by header (blank cells are null). */
function toObjects(grid) {
  const [header = [], ...body] = grid;
  return body.map((cells) => Object.fromEntries(
    header.map((h, i) => [String(h ?? '').trim(), cells[i] == null || cells[i] === '' ? null : cells[i]])
  ));
}

function excelCellValue(value) {
  if (value == null) return null;
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text).join('');
    if ('result' in value) return value.result ?? null;
    if ('text' in value) return value.text;
    if (value instanceof Date) return value.toISOString().slice(0, 10);
  }
  return value;
}

/** Every sheet of a CSV/TSV/Excel file as arrays of row objects. */
async function readSheets(buf, ext) {
  if (ext === 'csv' || ext === 'tsv') {
    const text = new TextDecoder().decode(buf).replace(/^\uFEFF/, '');
    return [toObjects(parseDelimited(text, ext === 'tsv' ? '\t' : ','))];
  }
  if (ext === 'xls') throw new Error('Old .xls files are not supported. Save it as .xlsx or .csv and upload again.');
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buf);
  return workbook.worksheets.map((sheet) => {
    const grid = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const values = row.values.slice(1).map(excelCellValue);
      grid.push(values);
    });
    return toObjects(grid);
  });
}

/**
 * Reads a CSV / Excel file in the tracker format.
 * Summary columns: Quarter, Location, Brand, Product line, Local sales, Pumped in, Pumped out, Source / notes
 * Dealer columns:  Quarter, Location, Brand, Direction, Dealer (In) or Market (Out), Units
 * Rolling 12-month rows: write the Quarter as "R12 2026-06" (the last month of the window).
 * Rows whose source says "sample" or "dummy" are skipped.
 */
export async function parseSheetFile(buf, ext, fallbackLoc) {
  const sheets = await readSheets(buf, ext);
  const sum = [];
  const dl = [];
  const rsum = [];
  const rdl = [];
  const warn = [];
  const sampleKeys = new Set();
  const realKeys = new Set();
  const pick = (row, ...names) => {
    for (const k of Object.keys(row)) {
      const nk = norm(k);
      if (names.some((n) => nk === n || nk.startsWith(n))) return row[k];
    }
    return undefined;
  };
  const r12End = (s) => {
    const m = /^R12\D*(\d{4})-(\d{1,2})$/i.exec(String(s).trim());
    return m ? `${m[1]}-${m[2].padStart(2, '0')}` : null;
  };

  for (const rows of sheets) {
    if (!rows.length) continue;
    const keys = Object.keys(rows[0]).map(norm);
    const isSum = keys.some((k) => k.startsWith('pumpedin')) && keys.some((k) => k.startsWith('pumpedout'));
    const isDl = keys.some((k) => k.startsWith('direction')) && keys.some((k) => k === 'units');
    for (const r of rows) {
      const period = String(pick(r, 'quarter', 'period') ?? '').trim();
      const location = String(pick(r, 'location', 'store') ?? fallbackLoc ?? '').trim();
      const brand = String(pick(r, 'brand', 'make') ?? '').trim();
      const E = r12End(period);
      if (isSum) {
        const line = String(pick(r, 'productline', 'line', 'model') ?? 'All').trim();
        const source = String(pick(r, 'source') ?? '');
        const nums = {
          local: Number(pick(r, 'localsales', 'local')) || 0,
          pin: Number(pick(r, 'pumpedin')) || 0,
          pout: Number(pick(r, 'pumpedout')) || 0,
        };
        if (!location || !brand) continue;
        if (E) {
          rsum.push({ end: E, start: mkey(mv(E) - 11), location, brand, line, ...nums, source: source || 'Spreadsheet upload' });
          continue;
        }
        if (qv(period) == null) continue;
        if (/sample|dummy/i.test(source)) { sampleKeys.add(`${period}|${location}|${brand}`); continue; }
        realKeys.add(`${period}|${location}|${brand}`);
        sum.push({ quarter: period, location, brand, line, ...nums, source: source || 'Spreadsheet upload' });
      } else if (isDl) {
        const dir = /^o/i.test(String(pick(r, 'direction') ?? '')) ? 'Out' : 'In';
        const name = String(pick(r, 'dealerinormarketout', 'dealer', 'market', 'name') ?? '').trim();
        const units = Number(pick(r, 'units')) || 0;
        if (!location || !brand || !name) continue;
        if (E) { rdl.push({ end: E, location, brand, dir, name, units }); continue; }
        if (qv(period) == null) continue;
        dl.push({ quarter: period, location, brand, dir, name, units, key: `${period}|${location}|${brand}` });
      }
    }
  }
  const dealers = dl
    .filter((d) => !(sampleKeys.has(d.key) && !realKeys.has(d.key)))
    .map(({ key: _key, ...d }) => d);
  if (sampleKeys.size) warn.push(`Skipped ${sampleKeys.size} quarter–store–brand groups marked as sample/dummy data.`);
  if (!sum.length && !dealers.length && !rsum.length) {
    warn.push('No rows matched the tracker columns. For rolling 12-month rows, write the Quarter as e.g. "R12 2026-06".');
  }
  return { sum, dl: dealers, rsum, rdl, warn };
}

export function toCsv(rows, cols) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.map((c) => c[0]).join(','), ...rows.map((r) => cols.map((c) => esc(r[c[1]])).join(','))].join('\n');
}

export function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
