/** US + DC state codes — used to keep Location filter as real places only. */
const US_STATE_CODES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID',
  'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO',
  'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA',
  'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
]);

const JUNK_LOCATION_RE =
  /dealership|inventory|explore|trusted|models|selection|latest|multi[- ]?state|for sale|motorhomes?|campers?|trailers?|\bdeals\b|\bsales\b/i;

/** Strip accents so "Santa María" and "Santa Maria" share one identity. */
export function stripLocationDiacritics(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

/**
 * Identity key for location dedupe / match:
 * lowercase, no accents, commas treated as spaces, collapsed whitespace.
 */
export function locationIdentityKey(value) {
  return stripLocationDiacritics(value)
    .toLowerCase()
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
  if (/[\u4e00-\u9fff]/.test(s)) return false; // Chinese / CJK junk
  if (JUNK_LOCATION_RE.test(s)) return false;

  const m = s.match(/,\s*([A-Za-z]{2})$/) || s.match(/\s([A-Za-z]{2})$/);
  if (!m) return false;
  return US_STATE_CODES.has(m[1].toUpperCase());
}

function parseCityState(value) {
  const s = String(value || '').trim().replace(/\s+/g, ' ');
  const m = s.match(/^(.*?)[,\s]+([A-Za-z]{2})$/);
  if (!m) return null;
  const city = m[1].replace(/,/g, '').replace(/\s+/g, ' ').trim();
  const state = m[2].toUpperCase();
  if (!city || !US_STATE_CODES.has(state)) return null;
  return { city, state };
}

/** Prefer "City, ST" (ASCII city) for the dropdown label. */
export function canonicalizeLocationLabel(value) {
  const parsed = parseCityState(value);
  if (!parsed) return String(value || '').trim();
  return `${stripLocationDiacritics(parsed.city)}, ${parsed.state}`;
}

function preferenceScore(value) {
  let score = 0;
  if (/,/.test(value)) score += 4;
  if (stripLocationDiacritics(value) === value) score += 2;
  if (/,\s*[A-Za-z]{2}$/.test(value)) score += 1;
  return score;
}

function pickPreferredLabel(variants) {
  const sorted = [...variants].sort(
    (a, b) => preferenceScore(b) - preferenceScore(a) || a.localeCompare(b)
  );
  return canonicalizeLocationLabel(sorted[0]);
}

function syntheticVariants(label) {
  const canon = canonicalizeLocationLabel(label);
  const noComma = canon.replace(/,\s*/, ' ');
  const out = new Set([label, canon, noComma].filter(Boolean));
  const stripped = stripLocationDiacritics(label);
  if (stripped && stripped !== label) {
    out.add(stripped);
    out.add(canonicalizeLocationLabel(stripped));
    out.add(canonicalizeLocationLabel(stripped).replace(/,\s*/, ' '));
  }
  return [...out];
}

/** canonical label → all raw + synthetic spellings for RPC match. */
let activeLocationVariants = new Map();

/**
 * Filter + dedupe location options.
 * Collapses "Fresno CA" / "Fresno, CA" and accent variants into one "City, ST".
 * Remembers raw variants so selected filters still match inventory rows.
 */
export function sanitizeVdpLocationOptions(locations) {
  const list = Array.isArray(locations) ? locations : [];
  const groups = new Map(); // identity key → raw variants[]

  for (const raw of list) {
    const s = String(raw || '').trim();
    if (!s || s === 'All') continue;
    if (!isCleanVdpLocationName(s)) continue;
    const key = locationIdentityKey(s);
    if (!key) continue;
    const bucket = groups.get(key);
    if (bucket) {
      if (!bucket.includes(s)) bucket.push(s);
    } else {
      groups.set(key, [s]);
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
    const listVariants = [...expanded];
    nextVariants.set(locationIdentityKey(label), listVariants);
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
    const variants = byLabel || byKey;

    if (variants?.length) {
      variants.forEach((v) => out.add(v));
    } else {
      syntheticVariants(loc).forEach((v) => out.add(v));
    }
  }

  return [...out];
}
