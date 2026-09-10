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
  return String(path || '').split(/[?#]/)[0].trim();
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

  // Interact: /product/{new|used}-{year}-{middle}-{id}-{id}
  let m = lower.match(
    /^\/product\/(new|used|pre-owned)-((?:19|20)\d{2})-(.+)-(\d+)-(\d+)\/?$/
  );
  if (m) {
    const middle = m[3];
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

  // Dealer Inspire / Peak: /inventory/{new|used}/{year}-{rest}
  m = lower.match(/^\/inventory\/(new|used|pre-owned)\/((?:19|20)\d{2})-(.+)\/?$/);
  if (m) {
    const rest = m[3];
    const resolved = matchMakeFromMiddle(rest, makeSlugs);
    const parts = rest.split('-').filter(Boolean);
    const stock = parts.length ? parts[parts.length - 1] : null;
    return {
      condition: titleCond(m[1]),
      year: m[2],
      make: resolved?.make || titleCaseSlug(parts[0]),
      model: resolved?.model
        ? resolved.model.replace(new RegExp(`\\s*${stock}$`, 'i'), '').trim() ||
          resolved.model
        : parts.length > 2
          ? titleCaseSlug(parts.slice(1, -1).join('-'))
          : null,
      type: null,
      stock,
      parser: 'inventory_cond_year',
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
