import { expandLocationsForRpc, isDealerBrandLocation } from '@/lib/vdp/locationFilterOptions';

/** Default VDP tab inventory filters (All = no restriction). */
export const DEFAULT_VDP_FILTERS = {
  year: 'All',
  condition: 'All',
  make: 'All',
  model: 'All',
  type: 'All',
  /** Empty array = all locations; otherwise selected location names. */
  location: [],
};

/** Normalize location filter to a string[] (empty = All). Accepts legacy 'All' / single string. */
export function selectedLocations(value) {
  if (value == null || value === 'All' || value === '') return [];
  if (Array.isArray(value)) {
    return [
      ...new Set(
        value
          .map((v) => String(v ?? '').trim())
          .filter((v) => v && v !== 'All')
          // Drop marketing junk if still stuck in UI state
          .filter((v) => !isDealerBrandLocation(v))
      ),
    ];
  }
  const one = String(value).trim();
  if (!one || one === 'All' || isDealerBrandLocation(one)) return [];
  return [one];
}

export function normalizeVdpFilters(input) {
  const merged = { ...DEFAULT_VDP_FILTERS, ...(input || {}) };
  return {
    ...merged,
    location: selectedLocations(merged.location),
  };
}

function slugPart(value) {
  return encodeURIComponent(String(value)).replace(/%/g, '_').slice(0, 48);
}

/** Any non-default VDP inventory filter selected. */
export function vdpFiltersActive(vdpFilters, tab) {
  if (tab !== 'vdp') return false;
  const f = normalizeVdpFilters(vdpFilters);
  return (
    f.year !== 'All' ||
    (f.condition !== 'All' && f.condition !== 'Used + New') ||
    f.make !== 'All' ||
    f.model !== 'All' ||
    f.type !== 'All' ||
    f.location.length > 0
  );
}

/**
 * Channel Breakdown filters — same inventory contract as make/year/type/KPI.
 * Location is included (aligned with Lab after live SQL path-join fix).
 */
export function channelBreakdownVdpFilters(vdpFilters) {
  return normalizeVdpFilters(vdpFilters);
}

/**
 * VDP Lab: same full inventory filter contract as live channel.
 */
export function channelBreakdownLabVdpFilters(vdpFilters) {
  return normalizeVdpFilters(vdpFilters);
}

/** True when any inventory filter (including location) is active for channel. */
export function channelFiltersActive(vdpFilters, tab) {
  if (tab !== 'vdp') return false;
  const f = channelBreakdownVdpFilters(vdpFilters);
  return (
    f.year !== 'All' ||
    (f.condition !== 'All' && f.condition !== 'Used + New') ||
    f.make !== 'All' ||
    f.model !== 'All' ||
    f.type !== 'All' ||
    f.location.length > 0
  );
}

/** Lab: same as live channelFiltersActive. */
export function channelFiltersActiveLab(vdpFilters, tab) {
  return channelFiltersActive(vdpFilters, tab);
}

/** Cache key for live channel — includes location (v2: location-aware). */
export function channelFilterCacheSuffix(vdpFilters, tab) {
  return `|chv2${vdpFilterCacheSuffix(channelBreakdownVdpFilters(vdpFilters), tab)}`;
}

/** Lab cache key — includes location (v9: chunked + fast path join). */
export function channelFilterLabCacheSuffix(vdpFilters, tab) {
  return `|labv9${vdpFilterCacheSuffix(channelBreakdownLabVdpFilters(vdpFilters), tab)}`;
}

/** Map UI filters → Supabase RPC params (VDP tab only). */
export function vdpFiltersToRpcParams(vdpFilters, tab) {
  if (tab !== 'vdp') return {};
  const f = normalizeVdpFilters(vdpFilters);
  const params = { p_condition: 'BOTH' };

  if (f.year && f.year !== 'All') {
    const y = parseInt(String(f.year), 10);
    if (Number.isFinite(y) && y >= 1900 && y <= 2100) params.p_years = [y];
  }
  if (f.make && f.make !== 'All') params.p_makes = [f.make];
  if (f.model && f.model !== 'All') params.p_models = [f.model];
  if (f.type && f.type !== 'All') params.p_types = [f.type];
  if (f.location && f.location !== 'All') {
    // Include comma / accent spellings so inventory rows still match.
    // SQL also soft-matches via vdp_location_identity (City, ST ≡ City ST).
    params.p_locations = expandLocationsForRpc(f.location);
  }

  if (f.condition === 'Used') params.p_condition = 'USED';
  else if (f.condition === 'New') params.p_condition = 'NEW';
  else params.p_condition = 'BOTH';

  return params;
}

/** Backward-compatible alias. */
export function vdpRpcExtraParams(vdpFilters, tab) {
  return vdpFiltersToRpcParams(vdpFilters, tab);
}

export function vdpFilterCacheSuffix(vdpFilters, tab) {
  if (tab !== 'vdp') return '';
  const f = normalizeVdpFilters(vdpFilters);
  const parts = [];
  if (f.year !== 'All') parts.push(`y${f.year}`);
  if (f.condition !== 'All' && f.condition !== 'Used + New') {
    parts.push(`c${slugPart(f.condition)}`);
  }
  if (f.make !== 'All') parts.push(`mk${slugPart(f.make)}`);
  if (f.model !== 'All') parts.push(`md${slugPart(f.model)}`);
  if (f.type !== 'All') parts.push(`t${slugPart(f.type)}`);
  if (f.location.length > 0) {
    parts.push(
      `l${[...f.location]
        .sort()
        .map((loc) => slugPart(loc))
        .join('~')}`
    );
  }
  return parts.length ? `|${parts.join('-')}` : '';
}

/** @deprecated use vdpFilterCacheSuffix */
export function yearFilterCacheSuffix(vdpFilters, tab) {
  return vdpFilterCacheSuffix(vdpFilters, tab);
}

export function appendInvParamsToSearchParams(searchParams, inv) {
  if (!inv) return;
  if (inv.p_years?.length) searchParams.set('years', inv.p_years.join(','));
  if (inv.p_makes?.length) searchParams.set('makes', inv.p_makes.join(','));
  if (inv.p_models?.length) searchParams.set('models', inv.p_models.join(','));
  if (inv.p_types?.length) searchParams.set('types', inv.p_types.join(','));
  // Location names contain commas ("Jackson, TN") — use | delimiter, not comma
  if (inv.p_locations?.length) {
    searchParams.set('locations', inv.p_locations.join('|'));
  }
  if (inv.p_condition && inv.p_condition !== 'BOTH') {
    searchParams.set('condition', inv.p_condition);
  }
}

export function appendVdpFiltersToSearchParams(searchParams, vdpFilters, tab) {
  appendInvParamsToSearchParams(searchParams, vdpFiltersToRpcParams(vdpFilters, tab));
}

export function parseVdpFiltersFromSearchParams(searchParams) {
  const parseList = (key) => {
    const raw = searchParams.get(key)?.trim();
    if (!raw) return null;
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  };

  const years = parseList('years');
  const makes = parseList('makes');
  const models = parseList('models');
  const types = parseList('types');
  // Location names contain commas ("Jackson, TN") — use | delimiter
  const locationsRaw = searchParams.get('locations')?.trim();
  const locations = locationsRaw
    ? locationsRaw.includes('|')
      ? locationsRaw.split('|').map((s) => s.trim()).filter(Boolean)
      : [locationsRaw]
    : null;
  const condition = searchParams.get('condition')?.trim()?.toUpperCase();

  const filters = { ...DEFAULT_VDP_FILTERS };
  if (years?.length) filters.year = String(years[0]);
  if (makes?.length) filters.make = makes[0];
  if (models?.length) filters.model = models[0];
  if (types?.length) filters.type = types[0];
  if (locations?.length) filters.location = locations;
  if (condition === 'USED') filters.condition = 'Used';
  else if (condition === 'NEW') filters.condition = 'New';

  return normalizeVdpFilters(filters);
}

export function parseInvRpcFromSearchParams(searchParams) {
  const years = searchParams.get('years')?.trim();
  const makes = searchParams.get('makes')?.trim();
  const models = searchParams.get('models')?.trim();
  const types = searchParams.get('types')?.trim();
  const locations = searchParams.get('locations')?.trim();
  const condition = searchParams.get('condition')?.trim()?.toUpperCase();

  // Location names contain commas ("Jackson, TN"). Prefer | delimiter;
  // if no | present, treat the whole string as one location.
  const parseLocations = (raw) => {
    if (!raw) return undefined;
    if (raw.includes('|')) {
      return raw.split('|').map((s) => s.trim()).filter(Boolean);
    }
    return [raw.trim()];
  };

  return {
    ...(years
      ? { p_years: years.split(',').map((y) => parseInt(y, 10)).filter(Number.isFinite) }
      : {}),
    ...(makes ? { p_makes: makes.split(',').map((s) => s.trim()).filter(Boolean) } : {}),
    ...(models ? { p_models: models.split(',').map((s) => s.trim()).filter(Boolean) } : {}),
    ...(types ? { p_types: types.split(',').map((s) => s.trim()).filter(Boolean) } : {}),
    ...(parseLocations(locations) ? { p_locations: parseLocations(locations) } : {}),
    ...(condition && condition !== 'BOTH' ? { p_condition: condition } : { p_condition: 'BOTH' }),
  };
}
