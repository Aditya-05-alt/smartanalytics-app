import fs from 'fs';
import ExcelJS from 'exceljs';

const VDP_RE =
  /^\/inventory\/(new|used)\/(\d{4})-([A-Za-z0-9]+(?:-[A-Za-z0-9]+)+)\/?$/i;

/** Longest-first type phrases as they appear in Peak Honda URL slugs */
const TYPE_PHRASES = [
  'big-wheel-dirt-bike',
  'cargo-trailer-open',
  'utility-trailer',
  'boat-trailer',
  'dirt-bike',
  'pontoon-trlr',
  'motorcycle',
  'class-a',
  'atv',
  'utv',
  'boat',
  'outboard',
].sort((a, b) => b.length - a.length);

const urlsPath = 'exports/peak_honda_june_2026_unknown_urls.txt';
const outPath = 'exports/peak_honda_june_2026_unknown_parsed_fields.xlsx';

function pagePathFromUrl(url) {
  try {
    return new URL(url.trim()).pathname.replace(/\/+$/, '') || '/';
  } catch {
    return url.trim();
  }
}

function findType(parts) {
  const joined = parts.join('-').toLowerCase();
  for (const phrase of TYPE_PHRASES) {
    if (joined === phrase) return phrase;
    if (joined.endsWith('-' + phrase)) {
      const before = parts
        .join('-')
        .slice(0, -(phrase.length + 1))
        .split('-')
        .filter(Boolean);
      return { type: phrase, before };
    }
  }
  return null;
}

/**
 * Parse /inventory/{condition}/{year}-{make}-{model}-{type}-{stock}
 * Stock is last token (or "do-not-use"). Type is a known phrase when present.
 */
function parseVdpPath(pagePath) {
  const m = pagePath.match(VDP_RE);
  if (!m) {
    return {
      matched: false,
      condition: '',
      year: '',
      make: '',
      model: '',
      type: '',
      stock: '',
    };
  }

  const condition = m[1].toLowerCase();
  const year = m[2];
  const slugParts = m[3].split('-');

  let stock;
  let body;
  if (
    slugParts.length >= 3 &&
    slugParts.slice(-3).join('-').toLowerCase() === 'do-not-use'
  ) {
    stock = 'do-not-use';
    body = slugParts.slice(0, -3);
  } else {
    stock = slugParts[slugParts.length - 1];
    body = slugParts.slice(0, -1);
  }

  const make = (body[0] || '').toLowerCase();
  const rest = body.slice(1);

  let model = '';
  let type = '';

  if (rest.length === 0) {
    // year-make-stock only
  } else {
    const typeHit = findType(rest);
    if (typeHit && typeof typeHit === 'object') {
      type = typeHit.type;
      model = typeHit.before.join('-');
    } else if (typeof typeHit === 'string') {
      // rest is only the type phrase
      type = typeHit;
      model = '';
    } else if (rest.length === 1) {
      // make-model-stock (no type in slug)
      model = rest[0];
      type = '';
    } else {
      // fallback: last token = type, middle = model
      type = rest[rest.length - 1];
      model = rest.slice(0, -1).join('-');
    }
  }

  return {
    matched: true,
    condition,
    year,
    make,
    model: model.toLowerCase(),
    type: type.toLowerCase(),
    stock: stock.toLowerCase(),
  };
}

const urls = fs
  .readFileSync(urlsPath, 'utf8')
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter(Boolean);

const rows = urls.map((url) => {
  const page_path = pagePathFromUrl(url);
  const p = parseVdpPath(page_path);
  return { url, page_path, ...p };
});

const wb = new ExcelJS.Workbook();
wb.creator = 'smartanalytics';

const summary = wb.addWorksheet('Summary');
summary.columns = [
  { header: 'Metric', key: 'm', width: 42 },
  { header: 'Value', key: 'v', width: 90 },
];
summary.addRows([
  { m: 'Dealer', v: 'Peak Honda World (2721177227)' },
  { m: 'Source', v: 'June 2026 unknown URLs only' },
  {
    m: 'URL shape',
    v: '/inventory/{condition}/{year}-{make}-{model}-{type}-{stock}',
  },
  {
    m: 'VDP regex',
    v: '^/inventory/(?:new|used)/\\d{4}-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+/?$',
  },
  { m: 'Unique URLs', v: rows.length },
  { m: 'Parsed OK', v: rows.filter((r) => r.matched).length },
  { m: 'Parse failed', v: rows.filter((r) => !r.matched).length },
  {
    m: 'With type filled',
    v: rows.filter((r) => r.matched && r.type).length,
  },
  {
    m: 'Without type (make-model-stock)',
    v: rows.filter((r) => r.matched && !r.type).length,
  },
]);
summary.getRow(1).font = { bold: true };

const ws = wb.addWorksheet('Parsed Fields');
ws.columns = [
  { header: 'url', key: 'url', width: 88 },
  { header: 'page_path', key: 'page_path', width: 68 },
  { header: 'condition', key: 'condition', width: 12 },
  { header: 'year', key: 'year', width: 8 },
  { header: 'make', key: 'make', width: 14 },
  { header: 'model', key: 'model', width: 36 },
  { header: 'type', key: 'type', width: 22 },
  { header: 'stock', key: 'stock', width: 16 },
  { header: 'matched_vdp_regex', key: 'matched', width: 18 },
];
ws.getRow(1).font = { bold: true };
ws.getRow(1).fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFE2E8F0' },
};

for (const r of rows) {
  ws.addRow({
    url: r.url,
    page_path: r.page_path,
    condition: r.condition,
    year: r.year,
    make: r.make,
    model: r.model,
    type: r.type,
    stock: r.stock,
    matched: r.matched ? 'YES' : 'NO',
  });
}

ws.autoFilter = { from: 'A1', to: 'I1' };
ws.views = [{ state: 'frozen', ySplit: 1 }];

await wb.xlsx.writeFile(outPath);

// quick sanity samples
const samples = rows.filter((r) =>
  [
    '/inventory/new/2026-honda-cbr600rr-motorcycle-tk300863',
    '/inventory/new/2025-honda-rebel-300-cmx300s-motorcycle-s5800062',
    '/inventory/new/2026-honda-crf125f-dirt-bike-t3302002',
    '/inventory/new/2026-honda-cb300rat-t5600606',
    '/inventory/new/2026-honda-trx250xt-atv-tj202745',
    '/inventory/new/2025-echo-elite-eew-9-13-utility-trailer-sa078545',
  ].includes(r.page_path)
);

console.log(
  JSON.stringify(
    {
      out: outPath,
      total: rows.length,
      parsed: rows.filter((r) => r.matched).length,
      with_type: rows.filter((r) => r.type).length,
      without_type: rows.filter((r) => r.matched && !r.type).length,
      samples: rows
        .slice(0, 5)
        .concat(
          rows.find((r) => r.page_path.includes('dirt-bike')) || [],
          rows.find((r) => r.page_path.includes('cb300rat-t5600606')) || []
        )
        .filter(Boolean)
        .map((r) => ({
          path: r.page_path,
          condition: r.condition,
          year: r.year,
          make: r.make,
          model: r.model,
          type: r.type,
          stock: r.stock,
        })),
    },
    null,
    2
  )
);
