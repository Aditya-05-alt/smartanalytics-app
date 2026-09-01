/**
 * Peak Honda Jul–Aug 2026 unknown URL → inv_* backfill helper.
 * Reads matching page_paths from exports, emits SQL for MCP execute_sql.
 *
 * Usage: node scripts/peak-honda-jul-aug-backfill-unknown-inv.mjs
 */
import fs from 'fs';

const CLIENT_ID = '2721177227';
const FROM = '2026-07-01';
const TO = '2026-08-31';

const VDP_RE =
  /^\/inventory\/(new|used)\/(\d{4})-([A-Za-z0-9]+(?:-[A-Za-z0-9]+)+)\/?$/i;

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

const TYPE_LABEL = {
  motorcycle: 'Motorcycle',
  'dirt-bike': 'Dirt Bike',
  'big-wheel-dirt-bike': 'Dirt Bike',
  atv: 'Atv',
  utv: 'Utv',
  boat: 'Boat',
  outboard: 'Outboard',
  'utility-trailer': 'Utility Trailer',
  'boat-trailer': 'Boat Trailer',
  'cargo-trailer-open': 'Utility Trailer',
  'pontoon-trlr': 'Boat Trailer',
  'class-a': 'Class A',
};

const PATHS_FILE =
  process.argv[2] || 'exports/peak_honda_jul_aug_2026_unknown_urls.txt';
const OUT_TAG = process.argv[3] || 'jul_aug';

const MAKE_LABEL = {
  honda: 'Honda',
  echo: 'Echo',
  ktm: 'KTM',
  husqvarna: 'Husqvarna',
  vm: 'VM',
  yamaha: 'Yamaha',
  kawasaki: 'Kawasaki',
  suzuki: 'Suzuki',
  bmw: 'BMW',
  'harley-davidson': 'Harley-Davidson',
};

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

function parseVdpPath(pagePath) {
  const m = pagePath.match(VDP_RE);
  if (!m) return null;

  const conditionRaw = m[1].toLowerCase();
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

  const makeRaw = (body[0] || '').toLowerCase();
  const rest = body.slice(1);
  let model = '';
  let typeRaw = '';

  if (rest.length > 0) {
    const typeHit = findType(rest);
    if (typeHit && typeof typeHit === 'object') {
      typeRaw = typeHit.type;
      model = typeHit.before.join('-');
    } else if (typeof typeHit === 'string') {
      typeRaw = typeHit;
      model = '';
    } else if (rest.length === 1) {
      model = rest[0];
      typeRaw = '';
    } else {
      model = rest.join('-');
      typeRaw = '';
    }
  }

  const condition =
    conditionRaw === 'used' ? 'Used' : conditionRaw === 'new' ? 'New' : '';
  const make =
    MAKE_LABEL[makeRaw] ||
    (makeRaw ? makeRaw.charAt(0).toUpperCase() + makeRaw.slice(1) : '');
  const type = typeRaw ? TYPE_LABEL[typeRaw] || typeRaw : '';

  return {
    page_path: pagePath.replace(/\/+$/, '') || pagePath,
    condition,
    year,
    make,
    model: model.toLowerCase(),
    type,
    stock: stock.toLowerCase(),
  };
}

function sqlLiteral(s) {
  if (s == null || s === '') return 'NULL';
  return `'${String(s).replace(/'/g, "''")}'`;
}

function normalizeMakeFromSlug(slugParts) {
  // Multi-token makes: harley-davidson
  const lower = slugParts.map((s) => s.toLowerCase());
  if (lower[0] === 'harley' && lower[1] === 'davidson') {
    return {
      makeRaw: 'harley-davidson',
      rest: slugParts.slice(2),
    };
  }
  return { makeRaw: lower[0] || '', rest: slugParts.slice(1) };
}

// Patch parse to use multi-token makes
const _parseVdpPath = parseVdpPath;
function parseVdpPathFixed(pagePath) {
  const m = pagePath.match(VDP_RE);
  if (!m) return null;
  const conditionRaw = m[1].toLowerCase();
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
  const { makeRaw, rest } = normalizeMakeFromSlug(body);
  let model = '';
  let typeRaw = '';
  if (rest.length > 0) {
    const typeHit = findType(rest);
    if (typeHit && typeof typeHit === 'object') {
      typeRaw = typeHit.type;
      model = typeHit.before.join('-');
    } else if (typeof typeHit === 'string') {
      typeRaw = typeHit;
      model = '';
    } else if (rest.length === 1) {
      model = rest[0];
      typeRaw = '';
    } else {
      model = rest.join('-');
      typeRaw = '';
    }
  }
  const condition =
    conditionRaw === 'used' ? 'Used' : conditionRaw === 'new' ? 'New' : '';
  const make =
    MAKE_LABEL[makeRaw] ||
    (makeRaw ? makeRaw.charAt(0).toUpperCase() + makeRaw.slice(1) : '');
  const type = typeRaw ? TYPE_LABEL[typeRaw] || typeRaw : '';
  return {
    page_path: pagePath.replace(/\/+$/, '') || pagePath,
    condition,
    year,
    make,
    model: model.toLowerCase(),
    type,
    stock: stock.toLowerCase(),
  };
}

const paths = fs
  .readFileSync(PATHS_FILE, 'utf8')
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter(Boolean)
  .map((line) => {
    if (line.startsWith('http')) {
      try {
        return new URL(line).pathname.replace(/\/+$/, '') || '/';
      } catch {
        return line;
      }
    }
    return line.replace(/\/+$/, '') || line;
  });

const parsed = [];
const seen = new Set();
const skipped = [];
for (const page_path of paths) {
  if (seen.has(page_path)) continue;
  seen.add(page_path);
  const row = parseVdpPathFixed(page_path);
  if (!row) {
    skipped.push(page_path);
    continue;
  }
  parsed.push(row);
}

const valuesSql = parsed
  .map(
    (r) =>
      `  (${sqlLiteral(r.page_path)}, ${sqlLiteral(r.condition)}, ${sqlLiteral(r.year)}, ${sqlLiteral(r.make)}, ${sqlLiteral(r.model)}, ${sqlLiteral(r.type)}, ${sqlLiteral(r.stock)})`
  )
  .join(',\n');

const pathListSql = parsed.map((r) => sqlLiteral(r.page_path)).join(',\n  ');

const finalUpdateSql = `-- Peak Honda Jul–Aug 2026 unknown URL backfill (one-time)
-- client_id=${CLIENT_ID}, report_date ${FROM}..${TO}
-- Only rows with blank inv_url and vdp_conditions not true; regex-matching paths only.

UPDATE public.smart_final_data AS f
SET
  inv_condition = p.condition,
  inv_year = p.year,
  inv_make = p.make,
  inv_model = NULLIF(p.model, ''),
  inv_type = NULLIF(p.type, ''),
  inv_stock_number = NULLIF(p.stock, ''),
  inv_url = COALESCE(
    NULLIF(TRIM(f.inv_url), ''),
    NULLIF(TRIM(f.page_location), ''),
    f.page_path
  ),
  vdp_conditions = true
FROM (
  VALUES
${valuesSql}
) AS p(page_path, condition, year, make, model, type, stock)
WHERE f.client_id = '${CLIENT_ID}'
  AND f.report_date BETWEEN '${FROM}' AND '${TO}'
  AND f.page_path = p.page_path
  AND (f.inv_url IS NULL OR btrim(f.inv_url) = '')
  AND COALESCE(f.vdp_conditions, false) IS NOT TRUE;
`;

const ga4UpdateSql = `-- Companion: mark same Peak Honda Jul–Aug paths as VDP in GA4 page data
UPDATE public.smart_ga4_page_data
SET vdp_conditions = true
WHERE client_id = '${CLIENT_ID}'
  AND report_date BETWEEN '${FROM}' AND '${TO}'
  AND page_path IN (
  ${pathListSql}
  )
  AND COALESCE(vdp_conditions, false) IS NOT TRUE;
`;

fs.mkdirSync('exports', { recursive: true });
const mapFile = `exports/peak_honda_${OUT_TAG}_2026_backfill_map.json`;
const finalFile = `exports/peak_honda_${OUT_TAG}_2026_backfill_final.sql`;
const ga4File = `exports/peak_honda_${OUT_TAG}_2026_backfill_ga4.sql`;
fs.writeFileSync(mapFile, JSON.stringify({ parsed, skipped }, null, 2));
fs.writeFileSync(finalFile, finalUpdateSql);
fs.writeFileSync(ga4File, ga4UpdateSql);
if (OUT_TAG === 'jul_aug') {
  fs.writeFileSync(
    'supabase/migrations/20260901_peak_honda_jul_aug_unknown_url_backfill.sql',
    [
      '-- One-time Peak Honda (2721177227) Jul–Aug 2026 unknown URL → inv_* backfill.',
      '-- Applied via MCP execute_sql. Not a recurring job.',
      '-- Same parse rules as June: /inventory/{condition}/{year}-{make}-{model}-{type}-{stock}.',
      '',
      finalUpdateSql.trim(),
      '',
      ga4UpdateSql.trim(),
      '',
    ].join('\n')
  );
}

console.log(
  JSON.stringify(
    {
      paths_in: paths.length,
      parsed: parsed.length,
      skipped: skipped.length,
      with_type: parsed.filter((r) => r.type).length,
      without_type: parsed.filter((r) => !r.type).length,
      samples: parsed.slice(0, 3),
    },
    null,
    2
  )
);
