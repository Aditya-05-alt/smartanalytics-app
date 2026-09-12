/**
 * Best-effort VDP page_path parsers used by Step 4 logic_2 fill.
 * Covers the URL shapes we fix most often in manual dealer cleanups.
 */

function titleCond(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return null;
  if (s === 'new') return 'New';
  if (s === 'used' || s === 'pre-owned' || s === 'preowned' || s === 'certified') {
    return s.startsWith('pre') ? 'Pre-Owned' : s === 'certified' ? 'Certified' : 'Used';
  }
  return null;
}

function titleCaseSlug(slug) {
  const s = String(slug || '').trim();
  if (!s) return null;
  return s
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function slugifyMake(make) {
  return String(make || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Longest-slug make match against a hyphen middle segment.
 * @param {string} middle
 * @param {{ make: string, slug: string }[]} makeSlugs
 */
export function matchMakeFromMiddle(middle, makeSlugs) {
  const m = String(middle || '').toLowerCase().replace(/^-+|-+$/g, '');
  if (!m || !makeSlugs?.length) return null;
  let best = null;
  for (const row of makeSlugs) {
    const slug = row.slug;
    if (!slug) continue;
    if (m === slug || m.startsWith(`${slug}-`)) {
      if (!best || slug.length > best.slug.length) best = row;
    }
  }
  if (!best) return null;
  const modelSlug =
    m.length > best.slug.length + 1 ? m.slice(best.slug.length + 1) : '';
  return {
    make: best.make,
    model: modelSlug ? titleCaseSlug(modelSlug) : null,
  };
}

/**
 * Build make slug list (+ optional -rv / -rvs variants) from smart_make rows.
 */
export function buildMakeSlugs(makes) {
  const out = [];
  for (const row of makes || []) {
    const make = String(row.make || '').trim();
    if (!make) continue;
    const slug = slugifyMake(make);
    if (!slug) continue;
    out.push({ make, slug });
    if (!/(^|-)(rv|rvs)$/.test(slug)) {
      out.push({ make, slug: `${slug}-rv` });
      out.push({ make, slug: `${slug}-rvs` });
    }
  }
  return out;
}

function stripQuery(path) {
  let s = String(path || '').split(/[?#]/)[0].trim();
  // GA4 occasionally glues JS/JSON junk onto the path
  const junkAt = s.search(/'|,%20|"heading"/i);
  if (junkAt > 0) s = s.slice(0, junkAt);
  if (/Lifetime$/i.test(s)) s = s.replace(/Lifetime$/i, '');
  return s.replace(/-+$/g, '');
}

/** Common Scout / RV type slugs (longest first). */
const SCOUT_TYPE_SLUGS = [
  'destination-trailer',
  'cargo-trailer-enclosed',
  'gooseneck-trailer',
  'equipment-trailer',
  'deck-over-trailer',
  'roll-off-trailer',
  'utility-trailer',
  'trailer-utility',
  'automotive-other',
  'travel-trailer',
  'cargo-trailer',
  'dump-trailer',
  'tilt-trailer',
  'pickup-truck',
  'fifth-wheel',
  'toy-hauler',
  'car-hauler',
  'motorcycle',
  'golf-cart',
  'class-a',
  'class-b',
  'class-c',
  'pop-up',
  'boat',
  'suv',
  'other',
].sort((a, b) => b.length - a.length);

const SCOUT_TYPE_LABEL = {
  'destination-trailer': 'Destination Trailer',
  'travel-trailer': 'Travel Trailer',
  'fifth-wheel': 'Fifth Wheel',
  'toy-hauler': 'Toy Hauler',
  'class-a': 'Class A',
  'class-b': 'Class B',
  'class-c': 'Class C',
  'golf-cart': 'Golf Cart',
  'pop-up': 'Pop Up',
  'automotive-other': 'Automotive Other',
  'pickup-truck': 'Pickup Truck',
  motorcycle: 'Motorcycle',
  boat: 'Boat',
  suv: 'Suv',
  other: 'Other',
  'utility-trailer': 'Utility Trailer',
  'trailer-utility': 'Utility Trailer',
  'cargo-trailer': 'Cargo Trailer',
  'cargo-trailer-enclosed': 'Cargo Trailer',
  'dump-trailer': 'Dump Trailer',
  'tilt-trailer': 'Tilt Trailer',
  'car-hauler': 'Car Hauler',
  'roll-off-trailer': 'Roll Off Trailer',
  'gooseneck-trailer': 'Gooseneck Trailer',
  'equipment-trailer': 'Equipment Trailer',
  'deck-over-trailer': 'Deck Over Trailer',
};

/**
 * Built-in multi-word makes when smart_make has no Scout catalog.
 * Longest slug first via matchMakeFromMiddle.
 */
const BUILTIN_RV_MAKE_SLUGS = [
  { make: 'Oliver Travel Trailers', slug: 'oliver-travel-trailers' },
  { make: 'Highland Ridge', slug: 'highland-ridge-rv' },
  { make: 'Highland Ridge', slug: 'highland-ridge' },
  { make: 'Forest River', slug: 'forest-river-rv' },
  { make: 'Forest River', slug: 'forest-river' },
  { make: 'Grand Design', slug: 'grand-design' },
  { make: 'East To West', slug: 'east-to-west' },
  { make: 'Thor', slug: 'thor-motor-coach' },
  { make: 'Thor', slug: 'thor' },
  { make: 'Starcraft', slug: 'starcraft-rv' },
  { make: 'Starcraft', slug: 'starcraft' },
  { make: 'Forest River', slug: 'flagstaff' },
  { make: 'Forest River', slug: 'rockwood' },
  { make: 'Forest River', slug: 'palomino' },
  { make: 'Entegra Coach', slug: 'entegra-coach' },
  { make: 'Entegra', slug: 'entegra' },
  { make: 'Modern Buggy', slug: 'modern-buggy' },
  { make: 'Gorilla Rides', slug: 'gorilla-rides' },
  { make: 'Bass Tracker', slug: 'bass-tracker' },
  { make: 'Tracker', slug: 'tracker' },
  { make: 'Ranger', slug: 'ranger' },
  { make: 'Skeeter', slug: 'skeeter' },
  { make: 'Nitro', slug: 'nitro' },
  { make: 'Lowe', slug: 'lowe' },
  { make: 'Norstar', slug: 'norstar' },
  { make: 'Gmc', slug: 'gmc' },
  { make: 'Honda', slug: 'honda' },
  { make: 'Alliance', slug: 'alliance-rv' },
  { make: 'Alliance', slug: 'alliance' },
  { make: 'Brinkley', slug: 'brinkley' },
  { make: 'Jayco', slug: 'jayco' },
  { make: 'Sabre', slug: 'sabre' },
  { make: 'Keystone', slug: 'keystone-rv' },
  { make: 'Keystone', slug: 'keystone' },
  { make: 'Coachmen', slug: 'coachmen' },
  { make: 'Winnebago', slug: 'winnebago' },
  { make: 'Fleetwood', slug: 'fleetwood' },
  { make: 'Heartland', slug: 'heartland' },
  { make: 'Dutchmen', slug: 'dutchmen' },
  { make: 'Prime Time', slug: 'prime-time' },
  { make: 'Kz', slug: 'kz-rv' },
  { make: 'Kz', slug: 'k-z' },
  { make: 'Kz', slug: 'kz' },
  { make: 'Crossroads', slug: 'crossroads' },
  { make: 'Gulf Stream', slug: 'gulf-stream' },
  { make: 'Palomino', slug: 'palomino' },
  { make: 'Genesis Supreme', slug: 'genesis-supreme' },
  { make: 'Open Range', slug: 'open-range' },
  { make: 'Nexus', slug: 'nexus-rv' },
  { make: 'Nexus', slug: 'nexus' },
  { make: 'Monaco', slug: 'monaco' },
  { make: 'Cruiser', slug: 'cruiser-rv' },
  { make: 'Cruiser', slug: 'cruiser' },
  { make: 'Shasta', slug: 'shasta' },
  { make: 'Oliver', slug: 'oliver' },
  { make: 'Ford', slug: 'ford' },
  { make: 'Tesla', slug: 'tesla' },
  { make: 'Nissan', slug: 'nissan' },
  { make: 'Echo', slug: 'voyager-manufacturer-echo' },
  { make: 'Voyager', slug: 'voyager-manufacturer' },
  { make: 'Voyager', slug: 'voyager' },
  { make: 'Echo', slug: 'echo' },
  { make: 'Alcom', slug: 'alcom-llc' },
  { make: 'Alcom', slug: 'alcom' },
  { make: 'Pj Trailers', slug: 'pj-trailers' },
  { make: 'Pj Trailers', slug: 'pj' },
  { make: 'Rustic Trail', slug: 'rustic-trail-rv' },
  { make: 'Rustic Trail', slug: 'rustic-trail' },
  { make: 'Novae', slug: 'novae-llc' },
  { make: 'Novae', slug: 'novae' },
  { make: 'Sure-Trac', slug: 'sure-trac' },
  { make: 'American Cargo', slug: 'american-cargo-group' },
  { make: 'Haulmark', slug: 'haulmark' },
  { make: 'Criterion', slug: 'criterion-trailers' },
  { make: 'Criterion', slug: 'criterion' },
  { make: 'Silver Armor', slug: 'silver-armor' },
  { make: 'Buckshot', slug: 'buckshot-trailers' },
  { make: 'Horizon', slug: 'horizon-trailers' },
  { make: 'Horizon', slug: 'horizon' },
  { make: 'Texas Pride', slug: 'texas-pride-trailers-llc' },
  { make: 'Texas Pride', slug: 'texas-pride' },
  { make: 'Pace American', slug: 'pace-american' },
  { make: 'Homemade', slug: 'homemade' },
  { make: 'Xpress', slug: 'xpress' },
];

function mergeMakeSlugs(makeSlugs) {
  const seen = new Set();
  const out = [];
  for (const row of [...(makeSlugs || []), ...BUILTIN_RV_MAKE_SLUGS]) {
    const slug = String(row.slug || '').toLowerCase();
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push({ make: row.make, slug });
  }
  return out;
}

function extractTypeFromSlug(slug) {
  const s = String(slug || '').toLowerCase().replace(/^-+|-+$/g, '');
  if (!s) return { type: null, typeSlug: null, before: s, after: '' };
  for (const phrase of SCOUT_TYPE_SLUGS) {
    if (s === phrase) {
      return { type: SCOUT_TYPE_LABEL[phrase], typeSlug: phrase, before: '', after: '' };
    }
    if (s.startsWith(`${phrase}-`)) {
      return {
        type: SCOUT_TYPE_LABEL[phrase],
        typeSlug: phrase,
        before: '',
        after: s.slice(phrase.length + 1),
      };
    }
    if (s.endsWith(`-${phrase}`)) {
      return {
        type: SCOUT_TYPE_LABEL[phrase],
        typeSlug: phrase,
        before: s.slice(0, -(phrase.length + 1)),
        after: '',
      };
    }
    const mid = s.indexOf(`-${phrase}-`);
    if (mid >= 0) {
      return {
        type: SCOUT_TYPE_LABEL[phrase],
        typeSlug: phrase,
        before: s.slice(0, mid),
        after: s.slice(mid + phrase.length + 2),
      };
    }
  }
  return { type: null, typeSlug: null, before: s, after: '' };
}

function splitStock(slug) {
  const parts = String(slug || '')
    .split('-')
    .filter(Boolean);
  if (!parts.length) return { body: '', stock: null };
  if (parts.length < 2) return { body: parts.join('-'), stock: null };

  const last = parts[parts.length - 1];
  const prev = parts[parts.length - 2];

  // Floorplan + trailing index: 292rl-1, 27dbh-1 (short numeric suffix only)
  if (
    /^\d{1,2}$/.test(last) &&
    /[a-z]/i.test(prev) &&
    /\d/.test(prev) &&
    parts.length >= 3
  ) {
    return {
      body: parts.slice(0, -2).join('-'),
      stock: `${prev}-${last}`,
    };
  }

  const looksStock =
    /^(?:[a-z]{1,5}\d+[a-z0-9]*|\d{2,}[a-z0-9]*)$/i.test(last) ||
    /^po\d+/i.test(last) ||
    /^ut\d+/i.test(last) ||
    /^up\d+/i.test(last) ||
    /^wi\d+/i.test(last) ||
    /^fl\d+/i.test(last) ||
    /^(?:ht|rc|rt|h)\d+[a-z0-9]*$/i.test(last) ||
    /^[rc]\d+[a-z]?$/i.test(last);

  if (looksStock) {
    return { body: parts.slice(0, -1).join('-'), stock: last };
  }
  return { body: parts.join('-'), stock: null };
}

function resolveMakeModel(middle, makeSlugs) {
  const slugs = mergeMakeSlugs(makeSlugs);
  const resolved = matchMakeFromMiddle(middle, slugs);
  if (resolved) {
    let model = resolved.model
      ? resolved.model.replace(/\s+/g, ' ').trim()
      : null;
    // Brand-line slug (Flagstaff → Forest River): keep line name in model
    const matched = slugs.find(
      (s) =>
        s.make === resolved.make &&
        (String(middle || '').toLowerCase() === s.slug ||
          String(middle || '')
            .toLowerCase()
            .startsWith(`${s.slug}-`))
    );
    if (matched?.slug === 'flagstaff') {
      model = model ? `Flagstaff ${model}` : 'Flagstaff';
    }
    if (matched?.slug === 'rockwood') {
      model = model ? `Rockwood ${model}` : 'Rockwood';
    }
    return { make: resolved.make, model };
  }
  const parts = String(middle || '')
    .split('-')
    .filter(Boolean);
  return {
    make: parts[0] ? titleCaseSlug(parts[0]) : null,
    model: parts.length > 1 ? titleCaseSlug(parts.slice(1).join('-')) : null,
  };
}

/**
 * @returns {{
 *   condition: string|null,
 *   year: string|null,
 *   make: string|null,
 *   model: string|null,
 *   type: string|null,
 *   stock: string|null,
 *   parser: string|null
 * }}
 */
export function parseVdpPath(pagePath, { makeSlugs = [] } = {}) {
  const path = stripQuery(pagePath);
  const lower = path.toLowerCase();
  const empty = {
    condition: null,
    year: null,
    make: null,
    model: null,
    type: null,
    stock: null,
    parser: null,
  };
  if (!lower) return empty;

  // Interact: /product/{new|used}-{year}-{middle}-{id|floorplan}-{stock}
  // middle may include apostrophes, @, dims (ATC 8-dot-5'-x-28'), URL junk
  // stock is numeric; penultimate may be digits or alphanumeric floorplan (e.g. 21rr)
  let m = lower.match(
    /^\/product\/(new|used|pre-owned)-((?:19|20)\d{2})-(.+)-([a-z0-9@]+)-(\d+)\/?$/i
  );
  if (m) {
    const middle = m[3].replace(/%20/g, ' ').replace(/@/g, ' ');
    const resolved = matchMakeFromMiddle(middle, makeSlugs);
    return {
      condition: titleCond(m[1]),
      year: m[2],
      make: resolved?.make || titleCaseSlug(middle.split('-')[0]),
      model: resolved?.model || null,
      type: null,
      stock: m[5] || m[4] || null,
      parser: 'product_interact',
    };
  }

  // Interact short / truncated: /product/{new|used}-{year}-{middle} (no trailing ids)
  m = lower.match(
    /^\/product\/(new|used|pre-owned)-((?:19|20)\d{2})-(.+?)\/?$/i
  );
  if (m) {
    const middle = m[3].replace(/%20/g, ' ').replace(/@/g, ' ').replace(/-+$/g, '');
    const resolved = matchMakeFromMiddle(middle, makeSlugs);
    return {
      condition: titleCond(m[1]),
      year: m[2],
      make: resolved?.make || titleCaseSlug(middle.split('-')[0]),
      model: resolved?.model || null,
      type: null,
      stock: null,
      parser: 'product_interact_short',
    };
  }

  // Scout type-first: /inventory/{new|used}/{type}-{year}-{make}-{model}-{stock}
  m = lower.match(
    /^\/inventory\/(new|used|pre-owned)\/(destination-trailer|travel-trailer|fifth-wheel|toy-hauler|class-[abc]|golf-cart|pop-up|automotive-other|pickup-truck|motorcycle|boat|suv|other|utility-trailer|trailer-utility|cargo-trailer-enclosed|cargo-trailer|dump-trailer|tilt-trailer|car-hauler|roll-off-trailer|gooseneck-trailer|equipment-trailer|deck-over-trailer)-((?:19|20)\d{2})-(.+)\/?$/
  );
  if (m) {
    const type = SCOUT_TYPE_LABEL[m[2]] || titleCaseSlug(m[2]);
    const { body, stock } = splitStock(m[4]);
    const mm = resolveMakeModel(body, makeSlugs);
    return {
      condition: titleCond(m[1]),
      year: m[3],
      make: mm.make,
      // Exact make-slug matches leave model empty — fall back to type label
      model: mm.model || type || null,
      type,
      stock,
      parser: 'inventory_scout_type_year',
    };
  }

  // Scout / Dealer Inspire / Peak: /inventory/{new|used}/{year}-{rest}
  // rest may embed type slug (travel-trailer / fifth-wheel) mid-path
  m = lower.match(/^\/inventory\/(new|used|pre-owned)\/((?:19|20)\d{2})-(.+)\/?$/);
  if (m) {
    const rest = m[3];
    const typeHit = extractTypeFromSlug(rest);
    let middle = rest;
    let type = typeHit.type;
    if (typeHit.typeSlug) {
      // Prefer make/model from segments around the type token
      middle = [typeHit.before, typeHit.after].filter(Boolean).join('-');
    }
    const { body, stock } = splitStock(middle);
    const mm = resolveMakeModel(body || middle, makeSlugs);
    let model = mm.model;
    if (stock && model) {
      const stockTitle = titleCaseSlug(stock);
      if (model.toLowerCase().endsWith(stockTitle.toLowerCase())) {
        model = model.slice(0, -(stockTitle.length)).trim();
      }
    }
    return {
      condition: titleCond(m[1]),
      year: m[2],
      make: mm.make,
      model: model || type || null,
      type,
      stock,
      parser: 'inventory_cond_year',
    };
  }

  // Scout short stock-only: /inventory/{new|used}/{stock}  e.g. /inventory/used/c-2114 or /inventory/used/2151
  m = lower.match(
    /^\/inventory\/(new|used|pre-owned)\/((?:[a-z]{1,4}-?)?\d{3,}[a-z0-9]*)\/?$/
  );
  if (m) {
    const rawStock = m[2];
    let stockOut = rawStock.toUpperCase();
    const stockM = rawStock.match(/^([a-z]{1,4})-?(\d{3,}[a-z0-9]*)$/i);
    if (stockM) stockOut = `${stockM[1].toUpperCase()}-${stockM[2].toUpperCase()}`;
    return {
      condition: titleCond(m[1]),
      year: null,
      make: null,
      model: null,
      type: null,
      stock: stockOut,
      parser: 'inventory_scout_stock_only',
    };
  }

  // Overfuel / Tipton: /inventory/{new|used}-{year}-{rest}
  m = lower.match(/^\/inventory\/(new|used|pre-owned)-((?:19|20)\d{2})-(.+)\/?$/);
  if (m) {
    const rest = m[3];
    const resolved = matchMakeFromMiddle(rest, makeSlugs);
    const parts = rest.split('-').filter(Boolean);
    return {
      condition: titleCond(m[1]),
      year: m[2],
      make: resolved?.make || titleCaseSlug(parts[0]),
      model: resolved?.model || (parts.length > 1 ? titleCaseSlug(parts.slice(1).join('-')) : null),
      type: null,
      stock: null,
      parser: 'inventory_overfuel',
    };
  }

  // Motive-ish: /inventory/{New|Used}-{year}-...-{17vin}  (case-insensitive)
  m = lower.match(
    /^\/inventory\/(new|used)-((?:19|20)\d{2})-(.+)-([a-z0-9]{17})\/?$/
  );
  if (m) {
    const rest = m[3];
    const resolved = matchMakeFromMiddle(rest, makeSlugs);
    const parts = rest.split('-').filter(Boolean);
    return {
      condition: titleCond(m[1]),
      year: m[2],
      make: resolved?.make || titleCaseSlug(parts[0]),
      model: resolved?.model || (parts.length > 1 ? titleCaseSlug(parts.slice(1).join('-')) : null),
      type: null,
      stock: m[4].toUpperCase(),
      parser: 'inventory_motive_vin',
    };
  }

  // Beaver / Flip / Millers: /inventory/{year}-{rest}
  m = lower.match(/^\/inventory\/((?:19|20)\d{2})-(.+)\/?$/);
  if (m) {
    const rest = m[2];
    const resolved = matchMakeFromMiddle(rest, makeSlugs);
    const parts = rest.split('-').filter(Boolean);
    return {
      condition: null,
      year: m[1],
      make: resolved?.make || titleCaseSlug(parts[0]),
      model: resolved?.model || (parts.length > 1 ? titleCaseSlug(parts.slice(1).join('-')) : null),
      type: null,
      stock: null,
      parser: 'inventory_year_slug',
    };
  }

  // Link RV: /inventory/{id}/{slug}
  m = lower.match(/^\/inventory\/(\d+)\/(.+)\/?$/);
  if (m) {
    const rest = m[2];
    const yearMatch = rest.match(/(?:^|-)((?:19|20)\d{2})(?:-|$)/);
    const year = yearMatch ? yearMatch[1] : null;
    let middle = rest;
    if (year) middle = middle.replace(new RegExp(`(^|-)${year}(-|$)`), '$1').replace(/--+/g, '-').replace(/^-|-$/g, '');
    const resolved = matchMakeFromMiddle(middle, makeSlugs);
    const parts = middle.split('-').filter(Boolean);
    return {
      condition: null,
      year,
      make: resolved?.make || titleCaseSlug(parts[0]),
      model: resolved?.model || (parts.length > 1 ? titleCaseSlug(parts.slice(1).join('-')) : null),
      type: null,
      stock: m[1],
      parser: 'inventory_id_slug',
    };
  }

  // DealerOn-ish: /{condition}-{city}-{year}-{make}-...
  m = lower.match(
    /^\/(new|used|pre-owned)-([a-z0-9]+)-((?:19|20)\d{2})-([a-z0-9]+)-(.+)\/?$/
  );
  if (m) {
    const makeToken = m[4];
    const rest = `${makeToken}-${m[5]}`;
    const resolved = matchMakeFromMiddle(rest, makeSlugs);
    return {
      condition: titleCond(m[1]),
      year: m[3],
      make: resolved?.make || titleCaseSlug(makeToken),
      model: resolved?.model || titleCaseSlug(m[5].replace(/-[a-z0-9]{17}$/i, '')),
      type: null,
      stock: (m[5].match(/-([a-z0-9]{17})$/i) || [])[1]?.toUpperCase() || null,
      parser: 'dealeron_city',
    };
  }

  // Generic fallback: pull year + condition keywords; try make slug anywhere in path
  const year = (lower.match(/(?:^|\/|-)((?:19|20)\d{2})(?:\/|-|$)/) || [])[1] || null;
  let condition = null;
  if (/\/new(\/|-|$)/.test(lower) || /(^|-)new-/.test(lower)) condition = 'New';
  else if (/\/used(\/|-|$)/.test(lower) || /(^|-)used-/.test(lower)) condition = 'Used';
  else if (/pre-?owned/.test(lower)) condition = 'Pre-Owned';

  let make = null;
  let model = null;
  if (makeSlugs.length) {
    // Prefer matching against the last path segment slug
    const seg = (lower.split('/').filter(Boolean).pop() || '').replace(/^\d{4}-/, '');
    const resolved = matchMakeFromMiddle(seg, makeSlugs);
    if (resolved) {
      make = resolved.make;
      model = resolved.model;
    }
  }

  return {
    condition,
    year,
    make,
    model,
    type: null,
    stock: null,
    parser: year || condition || make ? 'generic' : 'url_only',
  };
}

/**
 * Mirror of SQL page_path_matches_vdp_logic for client-side filtering.
 */
export function pagePathMatchesVdpLogic(pagePath, vdpLogic) {
  const path = stripQuery(pagePath);
  if (!path) return false;
  const pats = String(vdpLogic || '')
    .split(/\s+OR\s+/i)
    .map((p) => p.trim())
    .filter((p) => p && !['true', 'false'].includes(p.toLowerCase()) && p.length >= 5);

  for (const pat of pats) {
    try {
      const re = new RegExp(pat, 'i');
      if (re.test(path)) return true;
      if (/^\^[A-Za-z0-9]/.test(pat)) {
        const withSlash = new RegExp(`^/${pat.slice(1)}`, 'i');
        if (withSlash.test(path)) return true;
      }
    } catch {
      // invalid regex — skip
    }
  }
  return false;
}
