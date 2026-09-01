/**
 * Peak Honda June 2026 unknown URL → inv_* backfill helper.
 * Builds VALUES rows + SQL; apply via Supabase MCP execute_sql (no service-role in shell).
 *
 * Usage: node scripts/peak-honda-june-backfill-unknown-inv.mjs
 */
import fs from 'fs';

const CLIENT_ID = '2721177227';
const FROM = '2026-06-01';
const TO = '2026-06-30';

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
};

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
      // Known-type only; do not invent type from last token
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

const urls = fs
  .readFileSync('exports/peak_honda_june_2026_unknown_urls.txt', 'utf8')
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter(Boolean);

const parsed = [];
const seen = new Set();
for (const url of urls) {
  const page_path = pagePathFromUrl(url);
  if (seen.has(page_path)) continue;
  seen.add(page_path);
  const row = parseVdpPath(page_path);
  if (!row) {
    console.error('FAILED PARSE', page_path);
    process.exit(1);
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

const finalUpdateSql = `-- Peak Honda June 2026 unknown URL backfill (one-time)
-- client_id=${CLIENT_ID}, report_date ${FROM}..${TO}
-- Only rows with blank inv_url and vdp_conditions not true.

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

const ga4UpdateSql = `-- Companion: mark same Peak Honda June paths as VDP in GA4 page data
UPDATE public.smart_ga4_page_data
SET vdp_conditions = true
WHERE client_id = '${CLIENT_ID}'
  AND report_date BETWEEN '${FROM}' AND '${TO}'
  AND page_path IN (
  ${pathListSql}
  )
  AND COALESCE(vdp_conditions, false) IS NOT TRUE;
`;

const verifySql = `-- Verify Peak Honda June unknowns after backfill
SELECT
  COUNT(*) FILTER (
    WHERE (inv_url IS NULL OR btrim(inv_url) = '')
      AND COALESCE(vdp_conditions, false) IS NOT TRUE
  ) AS still_unknown_vdp_false,
  COUNT(*) FILTER (
    WHERE inv_condition IS NULL OR btrim(inv_condition) = ''
  ) AS blank_condition,
  COUNT(*) FILTER (WHERE vdp_conditions IS TRUE AND inv_make IS NOT NULL) AS filled_vdp,
  SUM(views) FILTER (
    WHERE vdp_conditions IS TRUE
      AND inv_condition IS NOT NULL
      AND report_date BETWEEN '${FROM}' AND '${TO}'
  ) AS views_with_condition
FROM public.smart_final_data
WHERE client_id = '${CLIENT_ID}'
  AND report_date BETWEEN '${FROM}' AND '${TO}';
`;

fs.mkdirSync('exports', { recursive: true });
fs.writeFileSync(
  'exports/peak_honda_june_2026_backfill_map.json',
  JSON.stringify(parsed, null, 2)
);
fs.writeFileSync(
  'supabase/migrations/20260901_peak_honda_june_unknown_url_backfill.sql',
  [
    '-- One-time Peak Honda (2721177227) June 2026 unknown URL → inv_* backfill.',
    '-- Applied via MCP execute_sql. Not a recurring job.',
    '-- Parses /inventory/{condition}/{year}-{make}-{model}-{type}-{stock}.',
    '',
    finalUpdateSql.trim(),
    '',
    ga4UpdateSql.trim(),
    '',
  ].join('\n')
);
fs.writeFileSync('exports/peak_honda_june_2026_backfill_final.sql', finalUpdateSql);
fs.writeFileSync('exports/peak_honda_june_2026_backfill_ga4.sql', ga4UpdateSql);
fs.writeFileSync('exports/peak_honda_june_2026_backfill_verify.sql', verifySql);

console.log(
  JSON.stringify(
    {
      paths: parsed.length,
      with_type: parsed.filter((r) => r.type).length,
      without_type: parsed.filter((r) => !r.type).length,
      samples: parsed.slice(0, 3),
      files: [
        'exports/peak_honda_june_2026_backfill_map.json',
        'exports/peak_honda_june_2026_backfill_final.sql',
        'exports/peak_honda_june_2026_backfill_ga4.sql',
        'supabase/migrations/20260901_peak_honda_june_unknown_url_backfill.sql',
      ],
    },
    null,
    2
  )
);
