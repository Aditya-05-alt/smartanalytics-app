/** US + DC state codes — used to keep Location filter as real places only. */
const US_STATE_CODES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID',
  'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO',
  'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA',
  'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
]);

/** Full / alternate state names → 2-letter code (incl. common misspellings). */
const STATE_NAME_TO_CODE = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', floride: 'FL',
  georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN',
  iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME',
  maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI',
  wyoming: 'WY', 'district of columbia': 'DC',
};

const JUNK_LOCATION_RE =
  /dealership|inventory|explore|trusted|models|selection|latest|multi[- ]?state|for sale|motorhomes?|campers?|trailers?|\bdeals\b|\bsales\b|https?:|www\.|\.com/i;

/** Dealer brand / marketing titles mistaken for store cities (Gerzeny’s RV World, etc.). */
const DEALER_BRAND_LOCATION_RE =
  /\brv\s*world\b|\bautocaravanas?\b|\bmundo de\b|\bworld of\b|\bsupercenter\b/i;

/** Strip accents so "Santa María" and "Santa Maria" share one identity. */
export function stripLocationDiacritics(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

/**
 * Identity key for location dedupe / match:
 * lowercase, no accents, commas treated as spaces, collapsed whitespace.
 * Must stay aligned with SQL public.vdp_location_identity().
 */
export function locationIdentityKey(value) {
  return stripLocationDiacritics(value)
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveStateToken(token) {
  const t = stripLocationDiacritics(token).toLowerCase().trim();
  if (!t) return null;
  if (t.length === 2 && US_STATE_CODES.has(t.toUpperCase())) return t.toUpperCase();
  return STATE_NAME_TO_CODE[t] || null;
}

/**
 * Parse "Bradenton, FL" | "Bradenton FL" | "Bradenton, Florida" | "Bradenton, Floride".
 * Full state names require a comma so "Airstream of Arkansas" is not mangled.
 * Returns { city, state } or { city, state: null } for bare city.
 */
export function parseCityState(value) {
  const s = stripLocationDiacritics(String(value || ''))
    .trim()
    .replace(/\s+/g, ' ');
  if (!s) return null;

  // "City, ST" or "City, StateName" (comma required for full names)
  let m = s.match(/^(.*),\s*([A-Za-z][A-Za-z\s.]{1,20})$/);
  if (m) {
    const city = m[1].replace(/,/g, '').replace(/\s+/g, ' ').trim();
    const state = resolveStateToken(m[2]);
    if (city && state) return { city, state };
  }

  // "City ST" — 2-letter code only (never full state words without comma)
  m = s.match(/^(.*)\s+([A-Za-z]{2})$/);
  if (m) {
    const city = m[1].replace(/,/g, '').replace(/\s+/g, ' ').trim();
    const state = resolveStateToken(m[2]);
    if (city && state && m[2].length === 2) return { city, state };
  }

  // "City Florida/Floride" without comma — only when city is a short place name
  // (not "… of Arkansas" store titles).
  m = s.match(/^(.*)\s+([A-Za-z]{4,20})$/);
  if (m) {
    const state = resolveStateToken(m[2]);
    const city = m[1].replace(/,/g, '').replace(/\s+/g, ' ').trim();
    if (
      state &&
      city &&
      !/\bof$/i.test(city) &&
      city.split(/\s+/).length <= 3 &&
      !/\brv\b/i.test(city)
    ) {
      return { city, state };
    }
  }

  // Bare city (Bradenton, Nokomis, Fort Myers) — no state
  if (/^[A-Za-z][A-Za-z\s.'-]{1,40}$/.test(s) && !resolveStateToken(s)) {
    // Avoid treating "Bradenton Floride" as a single city if peel failed above
    return { city: s.trim(), state: null };
  }

  return null;
}

/** Group key so Bradenton ≡ Bradenton, FL ≡ Bradenton, Floride. */
export function locationGroupKey(value) {
  const parsed = parseCityState(value);
  if (parsed?.city) {
    return `city:${locationIdentityKey(parsed.city)}`;
  }
  return `raw:${locationIdentityKey(value)}`;
}

/**
 * Keep Location filter options aligned with Location Breakdown:
 * "City, ST" / "City ST" with a real US state — drop marketing / dealer titles.
 */
export function isCleanVdpLocationName(value) {
  const s = String(value || '').trim();
  if (!s) return false;
  if (s === 'All') return true;
  if (s.toLowerCase() === 'unknown') return false;
  if (s.length < 4 || s.length > 60) return false;
  if (/[\^\*]/.test(s)) return false;
  if (/[\u4e00-\u9fff]/.test(s)) return false;
  if (JUNK_LOCATION_RE.test(s)) return false;
  if (DEALER_BRAND_LOCATION_RE.test(s)) return false;

  const parsed = parseCityState(s);
  return Boolean(parsed?.city && parsed?.state);
}

/** Place-like names (city or city+state). Excludes dealer brand titles. */
export function isUsableVdpLocationName(value) {
  const s = String(value || '').trim();
  if (!s || s === 'All') return s === 'All';
  if (s.toLowerCase() === 'unknown') return false;
  if (s.length < 2 || s.length > 80) return false;
  if (/[\^\*]/.test(s)) return false;
  if (/[\u4e00-\u9fff]/.test(s)) return false;
  if (JUNK_LOCATION_RE.test(s)) return false;
  if (DEALER_BRAND_LOCATION_RE.test(s)) return false;
  // "Gerzeny's RV" parses as a bare "city" — treat as brand, not a place
  if (/\brv\b/i.test(s) && !parseCityState(s)?.state) return false;

  const parsed = parseCityState(s);
  if (parsed?.city && parsed?.state) return true;
  if (parsed?.city && !/\brv\b/i.test(parsed.city)) return true;

  // Moix-style store names without state still allowed if not brand junk
  return !/\brv\b/i.test(s);
}

/** Prefer "City, ST" when we know the state; else city-only. */
export function canonicalizeLocationLabel(value) {
  const parsed = parseCityState(value);
  if (!parsed?.city) return String(value || '').trim();
  const city = stripLocationDiacritics(parsed.city).replace(/\s+/g, ' ').trim();
  if (parsed.state) return `${city}, ${parsed.state}`;
  return city;
}

function preferenceScore(value) {
  const parsed = parseCityState(value);
  let score = 0;
  if (parsed?.state) score += 8;
  if (/,/.test(value)) score += 4;
  if (stripLocationDiacritics(value) === value) score += 2;
  if (/,\s*[A-Za-z]{2}$/.test(value)) score += 1;
  // Prefer shorter city-only over long dealer strings
  score -= Math.min(String(value).length, 40) * 0.01;
  return score;
}

function pickPreferredLabel(variants) {
  const sorted = [...variants].sort(
    (a, b) => preferenceScore(b) - preferenceScore(a) || a.localeCompare(b)
  );
  return canonicalizeLocationLabel(sorted[0]);
}

/** Common full-name aliases for a few states that appear mangled in inventory. */
const STATE_CODE_ALIASES = {
  FL: ['Florida', 'Floride'],
  TX: ['Texas'],
  AR: ['Arkansas'],
  MO: ['Missouri'],
  GA: ['Georgia'],
  AL: ['Alabama'],
  CA: ['California'],
};

function syntheticVariants(label) {
  const canon = canonicalizeLocationLabel(label);
  const parsed = parseCityState(label) || parseCityState(canon);
  const out = new Set([label, canon].filter(Boolean));

  if (parsed?.city) {
    out.add(parsed.city);
    if (parsed.state) {
      out.add(`${parsed.city}, ${parsed.state}`);
      out.add(`${parsed.city} ${parsed.state}`);
      for (const alias of STATE_CODE_ALIASES[parsed.state] || []) {
        out.add(`${parsed.city}, ${alias}`);
        out.add(`${parsed.city} ${alias}`);
      }
    }
  }

  const noComma = canon.replace(/,\s*/, ' ');
  out.add(noComma);
  const stripped = stripLocationDiacritics(label);
  if (stripped && stripped !== label) {
    out.add(stripped);
    out.add(canonicalizeLocationLabel(stripped));
  }
  return [...out].filter(Boolean);
}

/** canonical label → all raw + synthetic spellings for RPC match. */
let activeLocationVariants = new Map();

/**
 * Filter + dedupe location options.
 * Collapses Bradenton / Bradenton, FL / Bradenton, Floride → one "Bradenton, FL".
 * Drops dealer-brand junk (Gerzeny’s RV World, Spanish marketing titles).
 *
 * @param {string[]} locations
 * @param {{ configured?: string[] }} [opts]
 */
export function sanitizeVdpLocationOptions(locations, opts = {}) {
  const list = Array.isArray(locations) ? locations : [];
  const configured = Array.isArray(opts.configured) ? opts.configured : [];
  const groups = new Map(); // group key → raw variants[]

  const push = (raw, { force = false } = {}) => {
    const s = String(raw || '').trim();
    if (!s || s === 'All') return;
    if (!force && !isCleanVdpLocationName(s) && !isUsableVdpLocationName(s)) return;
    if (!force && DEALER_BRAND_LOCATION_RE.test(s)) return;
    const key = locationGroupKey(s);
    if (!key || key === 'raw:') return;
    const bucket = groups.get(key);
    if (bucket) {
      if (!bucket.includes(s)) bucket.push(s);
    } else {
      groups.set(key, [s]);
    }
  };

  for (const raw of list) push(raw);
  // Configured store names: keep even if unusual, unless brand junk
  for (const raw of configured) {
    const s = String(raw || '').trim();
    if (!s) continue;
    if (DEALER_BRAND_LOCATION_RE.test(s) && parseCityState(s)?.state == null) {
      // skip "Gerzeny’s RV World"-style configured noise when it's not a city
      continue;
    }
    push(s, { force: isUsableVdpLocationName(s) || Boolean(parseCityState(s)?.city) });
  }

  // If we have real city groups, drop leftover raw dealer-name groups
  const hasCityGroups = [...groups.keys()].some((k) => k.startsWith('city:'));
  if (hasCityGroups) {
    for (const key of [...groups.keys()]) {
      if (!key.startsWith('city:')) {
        const variants = groups.get(key) || [];
        const looksBrand = variants.some(
          (v) => DEALER_BRAND_LOCATION_RE.test(v) || /\brv\b/i.test(v)
        );
        if (looksBrand) groups.delete(key);
      }
    }
  }

  const out = ['All'];
  const nextVariants = new Map();

  const labels = [];
  for (const [, variants] of groups) {
    labels.push({ label: pickPreferredLabel(variants), variants });
  }
  labels.sort((a, b) => a.label.localeCompare(b.label));

  for (const { label, variants } of labels) {
    out.push(label);
    const expanded = new Set([
      ...variants,
      ...syntheticVariants(label),
      ...variants.flatMap((v) => syntheticVariants(v)),
    ]);
    // City-only + City,ST for matching inventory
    const parsed = parseCityState(label);
    if (parsed?.city) {
      expanded.add(parsed.city);
      if (parsed.state) {
        expanded.add(`${parsed.city}, ${parsed.state}`);
        expanded.add(`${parsed.city} ${parsed.state}`);
      }
    }
    const listVariants = [...expanded];
    nextVariants.set(locationIdentityKey(label), listVariants);
    nextVariants.set(locationGroupKey(label), listVariants);
    nextVariants.set(label, listVariants);
  }

  activeLocationVariants = nextVariants;
  return out;
}

/** Expand UI selection into all known spellings for p_locations. */
export function expandLocationsForRpc(selected) {
  const list = Array.isArray(selected) ? selected : selected ? [selected] : [];
  const out = new Set();

  for (const raw of list) {
    const loc = String(raw || '').trim();
    if (!loc || loc === 'All') continue;

    const byLabel = activeLocationVariants.get(loc);
    const byKey = activeLocationVariants.get(locationIdentityKey(loc));
    const byGroup = activeLocationVariants.get(locationGroupKey(loc));
    const variants = byLabel || byGroup || byKey;

    if (variants?.length) {
      variants.forEach((v) => out.add(v));
    } else {
      syntheticVariants(loc).forEach((v) => out.add(v));
    }
  }

  return [...out];
}

/**
 * Collapse Location Breakdown rows so Bradenton / Bradenton, FL share one slice.
 * Recomputes pct + rank. Keeps Unknown / Other as-is.
 * Dealer-brand junk (RV World, autocaravanas…) folds into Other when cities exist.
 */
export function collapseLocationBreakdownRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const groups = new Map(); // groupKey → { label, views, variants }
  let brandJunkViews = 0;

  for (const row of list) {
    const raw = String(
      row.location_bucket ?? row.location ?? row.inv_location ?? 'Unknown'
    ).trim() || 'Unknown';
    const views = Number(row.views ?? 0) || 0;
    if (views <= 0) continue;

    if (/^(unknown|other)$/i.test(raw)) {
      const key = `special:${raw.toLowerCase()}`;
      const prev = groups.get(key);
      if (prev) prev.views += views;
      else groups.set(key, { label: /other/i.test(raw) ? 'Other' : 'Unknown', views, special: true });
      continue;
    }

    if (DEALER_BRAND_LOCATION_RE.test(raw) || (JUNK_LOCATION_RE.test(raw) && !parseCityState(raw)?.city)) {
      brandJunkViews += views;
      continue;
    }

    const key = locationGroupKey(raw);
    const prev = groups.get(key);
    if (prev) {
      prev.views += views;
      if (!prev.variants.includes(raw)) prev.variants.push(raw);
      prev.label = pickPreferredLabel(prev.variants);
    } else {
      groups.set(key, {
        label: canonicalizeLocationLabel(raw),
        views,
        variants: [raw],
        special: false,
      });
    }
  }

  const hasCity = [...groups.keys()].some((k) => k.startsWith('city:'));
  if (brandJunkViews > 0) {
    if (hasCity) {
      const otherKey = 'special:other';
      const prev = groups.get(otherKey);
      if (prev) prev.views += brandJunkViews;
      else groups.set(otherKey, { label: 'Other', views: brandJunkViews, special: true });
    } else {
      // No cities — keep brand totals under a single Other so the chart isn't empty
      groups.set('special:other', { label: 'Other', views: brandJunkViews, special: true });
    }
  }

  const sorted = [...groups.values()].sort((a, b) => {
    const aOther = /^(unknown|other)$/i.test(a.label);
    const bOther = /^(unknown|other)$/i.test(b.label);
    if (aOther !== bOther) return aOther ? 1 : -1;
    return b.views - a.views || a.label.localeCompare(b.label);
  });
  const total = sorted.reduce((sum, g) => sum + g.views, 0) || 1;

  return sorted.map((g, index) => ({
    location_bucket: g.label,
    views: g.views,
    pct: Math.round((g.views / total) * 10000) / 100,
    rank: /^(unknown|other)$/i.test(g.label) ? 999 : index + 1,
  }));
}
