import { expandLocationsForRpc, isDealerBrandLocation } from '@/lib/vdp/locationFilterOptions';
import {
  CHANNEL_GROUP_DEFS,
  normalizeChannelKey,
} from '@/lib/ga4/channelGroups';

/** Paid Search / Cross-network / Display stay separate filter options (not bundled). */
export const VDP_PAID_SEARCH_FILTER_CHANNELS = [
  'Paid Search',
  'Cross-network',
  'Display',
];

/** Legacy rollup label — expand to individual channels if still in saved UI state. */
const LEGACY_PAID_SEARCH_BUNDLE_LABEL = 'Paid Search + Cross Network + Display';

/** Bundles that stay a single filter option (e.g. Paid Social + Organic Social). */
const VDP_CHANNEL_FILTER_BUNDLE_LABELS = CHANNEL_GROUP_DEFS.map((g) => g.label);

/** Ungrouped channels shown in the VDP Channel filter. */
const VDP_CHANNEL_FILTER_SOLOS = [
  'Direct',
  'Organic Search',
  'Referral',
  'Email',
  'Organic Video',
  'Paid Video',
  'Paid Other',
  'Unassigned',
  'AI Assistant',
  'SMS',
];

/** Filter labels: paid members + remaining bundles + solo channels. */
export const VDP_CHANNEL_FILTER_OPTIONS = [
  'All',
  ...VDP_PAID_SEARCH_FILTER_CHANNELS,
  ...VDP_CHANNEL_FILTER_BUNDLE_LABELS,
  ...VDP_CHANNEL_FILTER_SOLOS,
];

function paidSearchFilterLabelForRaw(rawName) {
  const key = normalizeChannelKey(rawName);
  return (
    VDP_PAID_SEARCH_FILTER_CHANNELS.find(
      (label) => normalizeChannelKey(label) === key
    ) || rawName
  );
}

/** Map one filter label → raw GA4 channel names for p_channels. */
function expandFilterLabelToRpcChannels(label) {
  if (label === LEGACY_PAID_SEARCH_BUNDLE_LABEL) {
    return [...VDP_PAID_SEARCH_FILTER_CHANNELS, 'Cross Network'];
  }
  if (normalizeChannelKey(label) === normalizeChannelKey('Cross-network')) {
    return ['Cross-network', 'Cross Network'];
  }
  const group = CHANNEL_GROUP_DEFS.find((g) => g.label === label);
  if (group) return [...group.members];
  return [label];
}

/** Expand legacy paid bundle label into separate paid filter options. */
function migrateLegacyChannelFilterLabels(labels) {
  const out = [];
  for (const label of labels) {
    if (label === LEGACY_PAID_SEARCH_BUNDLE_LABEL) {
      out.push(...VDP_PAID_SEARCH_FILTER_CHANNELS);
    } else {
      out.push(label);
    }
  }
  return [...new Set(out.filter(Boolean))];
}

/** Expand filter labels (incl. bundles) → raw GA4 channel names for p_channels. */
export function expandChannelsForRpc(selected) {
  const labels = selectedChannels(selected);
  if (labels.length === 0) return undefined;

  const out = [];
  for (const label of labels) {
    out.push(...expandFilterLabelToRpcChannels(label));
  }
  return [...new Set(out.filter(Boolean))];
}

/** Collapse raw/expanded channel names back to filter option labels. */
export function collapseChannelsToFilterLabels(rawChannels) {
  const raw = (Array.isArray(rawChannels) ? rawChannels : [])
    .map((v) => String(v ?? '').trim())
    .filter(Boolean);
  if (raw.length === 0) return [];

  const remaining = new Set(raw.map((c) => normalizeChannelKey(c)));
  const labels = [];

  for (const member of VDP_PAID_SEARCH_FILTER_CHANNELS) {
    const key = normalizeChannelKey(member);
    if (remaining.has(key)) {
      const filterLabel = paidSearchFilterLabelForRaw(member);
      if (!labels.includes(filterLabel)) labels.push(filterLabel);
      remaining.delete(key);
    }
  }
  // GA4 may emit "Cross Network" — same filter as Cross-network
  if (remaining.has(normalizeChannelKey('Cross Network'))) {
    if (!labels.includes('Cross-network')) labels.push('Cross-network');
    remaining.delete(normalizeChannelKey('Cross Network'));
  }

  for (const group of CHANNEL_GROUP_DEFS) {
    const hit = group.members.some((m) => remaining.has(normalizeChannelKey(m)));
    if (hit) {
      labels.push(group.label);
      for (const m of group.members) remaining.delete(normalizeChannelKey(m));
    }
  }

  for (const solo of VDP_CHANNEL_FILTER_SOLOS) {
    const key = normalizeChannelKey(solo);
    if (remaining.has(key)) {
      labels.push(solo);
      remaining.delete(key);
    }
  }

  for (const c of raw) {
    const key = normalizeChannelKey(c);
    if (remaining.has(key)) {
      labels.push(c);
      remaining.delete(key);
    }
  }

  return migrateLegacyChannelFilterLabels(labels);
}

/** Default VDP tab inventory filters (empty array = All / no restriction). */
export const DEFAULT_VDP_FILTERS = {
  year: [],
  condition: [],
  make: [],
  model: [],
  type: [],
  /** Empty array = all locations; otherwise selected location names. */
  location: [],
  /** Empty array = all channels; otherwise selected filter labels (may be bundles). */
  channel: [],
};

/** Normalize a multi-select filter to string[] (empty = All). Accepts legacy 'All' / single string. */
export function selectedFilterValues(value) {
  if (value == null || value === 'All' || value === '') return [];
  if (Array.isArray(value)) {
    return [
      ...new Set(
        value
          .map((v) => String(v ?? '').trim())
          .filter((v) => v && v !== 'All' && v !== 'Used + New')
      ),
    ];
  }
  const one = String(value).trim();
  if (!one || one === 'All' || one === 'Used + New') return [];
  return [one];
}

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

/** Normalize channel filter to string[] of filter labels (empty = All). */
export function selectedChannels(value) {
  if (value == null || value === 'All' || value === '') return [];
  if (Array.isArray(value)) {
    return [
      ...new Set(
        value
          .map((v) => String(v ?? '').trim())
          .filter((v) => v && v !== 'All')
      ),
    ];
  }
  const one = String(value).trim();
  if (!one || one === 'All') return [];
  // Legacy single member → collapse to bundle label when applicable
  return collapseChannelsToFilterLabels([one]);
}

export function normalizeVdpFilters(input) {
  const merged = { ...DEFAULT_VDP_FILTERS, ...(input || {}) };
  // Legacy single condition / "Used + New" → multi array
  let condition = selectedFilterValues(merged.condition);
  if (
    !Array.isArray(merged.condition) &&
    (merged.condition === 'Used + New' || merged.condition === 'All')
  ) {
    condition = [];
  }
  return {
    ...merged,
    year: selectedFilterValues(merged.year),
    condition,
    make: selectedFilterValues(merged.make),
    model: selectedFilterValues(merged.model),
    type: selectedFilterValues(merged.type),
    location: selectedLocations(merged.location),
    channel: migrateLegacyChannelFilterLabels(selectedChannels(merged.channel)),
  };
}

function slugPart(value) {
  return encodeURIComponent(String(value)).replace(/%/g, '_').slice(0, 48);
}

function hasMultiSelection(values) {
  return Array.isArray(values) && values.length > 0;
}

/** Map condition multi-select → RPC p_condition. */
export function conditionSelectionToRpc(condition) {
  const list = selectedFilterValues(condition).map((c) => c.toLowerCase());
  const wantsNew = list.some((c) => c === 'new');
  const wantsUsed = list.some((c) => c === 'used' || c === 'pre-owned' || c === 'preowned');
  if (wantsNew && !wantsUsed) return 'NEW';
  if (wantsUsed && !wantsNew) return 'USED';
  return 'BOTH';
}

/** Any non-default VDP inventory / channel filter selected. */
export function vdpFiltersActive(vdpFilters, tab) {
  if (tab !== 'vdp') return false;
  const f = normalizeVdpFilters(vdpFilters);
  return (
    hasMultiSelection(f.year) ||
    hasMultiSelection(f.condition) ||
    hasMultiSelection(f.make) ||
    hasMultiSelection(f.model) ||
    hasMultiSelection(f.type) ||
    f.location.length > 0 ||
    f.channel.length > 0
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

/** True when any inventory / channel filter is active for channel breakdown. */
export function channelFiltersActive(vdpFilters, tab) {
  return vdpFiltersActive(vdpFilters, tab);
}

/** Channel Breakdown rollups — skip when a channel filter is selected (show flat names). */
export function channelBreakdownUsesGroups(vdpFilters, tab) {
  if (tab !== 'vdp') return true;
  return selectedChannels(vdpFilters?.channel).length === 0;
}

/** Lab: same as live channelFiltersActive. */
export function channelFiltersActiveLab(vdpFilters, tab) {
  return channelFiltersActive(vdpFilters, tab);
}

/** Cache key for live channel — soft condition match + multi bundles (v6). */
export function channelFilterCacheSuffix(vdpFilters, tab) {
  return `|chv6${vdpFilterCacheSuffix(channelBreakdownVdpFilters(vdpFilters), tab)}`;
}

/** Lab cache key — includes location (v9: chunked + fast path join). */
export function channelFilterLabCacheSuffix(vdpFilters, tab) {
  return `|labv9${vdpFilterCacheSuffix(channelBreakdownLabVdpFilters(vdpFilters), tab)}`;
}

/** Map UI filters → Supabase RPC params (VDP tab only). */
export function vdpFiltersToRpcParams(vdpFilters, tab) {
  if (tab !== 'vdp') return {};
  const f = normalizeVdpFilters(vdpFilters);
  const params = { p_condition: conditionSelectionToRpc(f.condition) };

  const years = f.year
    .map((y) => parseInt(String(y), 10))
    .filter((y) => Number.isFinite(y) && y >= 1900 && y <= 2100);
  if (years.length) params.p_years = years;
  if (f.make.length) params.p_makes = f.make;
  if (f.model.length) params.p_models = f.model;
  if (f.type.length) params.p_types = f.type;
  if (f.location.length) {
    // Include comma / accent spellings so inventory rows still match.
    // SQL also soft-matches via vdp_location_identity (City, ST ≡ City ST).
    params.p_locations = expandLocationsForRpc(f.location);
  }

  const channels = expandChannelsForRpc(f.channel);
  if (channels?.length) params.p_channels = channels;

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
  if (f.year.length) {
    parts.push(`y${[...f.year].sort().map((y) => slugPart(y)).join('~')}`);
  }
  if (f.condition.length) {
    parts.push(`c${[...f.condition].sort().map((c) => slugPart(c)).join('~')}`);
  }
  if (f.make.length) {
    parts.push(`mk${[...f.make].sort().map((m) => slugPart(m)).join('~')}`);
  }
  if (f.model.length) {
    parts.push(`md${[...f.model].sort().map((m) => slugPart(m)).join('~')}`);
  }
  if (f.type.length) {
    parts.push(`t${[...f.type].sort().map((t) => slugPart(t)).join('~')}`);
  }
  if (f.location.length > 0) {
    parts.push(
      `l${[...f.location]
        .sort()
        .map((loc) => slugPart(loc))
        .join('~')}`
    );
  }
  if (f.channel.length > 0) {
    parts.push(
      `ch${[...f.channel]
        .sort()
        .map((c) => slugPart(c))
        .join('~')}`
    );
  }
  return parts.length ? `|ms1-${parts.join('-')}` : '';
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
  if (inv.p_channels?.length) {
    searchParams.set('channels', inv.p_channels.join('|'));
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
  if (years?.length) filters.year = years.map(String);
  if (makes?.length) filters.make = makes;
  if (models?.length) filters.model = models;
  if (types?.length) filters.type = types;
  if (locations?.length) filters.location = locations;
  if (condition === 'USED') filters.condition = ['Used'];
  else if (condition === 'NEW') filters.condition = ['New'];
  else if (condition === 'BOTH' || !condition) filters.condition = [];
  else {
    // Multi: NEW|USED
    const parts = condition.split(/[|,]/).map((s) => s.trim().toUpperCase()).filter(Boolean);
    const cond = [];
    if (parts.includes('NEW')) cond.push('New');
    if (parts.includes('USED')) cond.push('Used');
    filters.condition = cond;
  }

  const channelsRaw = searchParams.get('channels')?.trim();
  if (channelsRaw) {
    const expanded = channelsRaw.includes('|')
      ? channelsRaw.split('|').map((s) => s.trim()).filter(Boolean)
      : [channelsRaw];
    filters.channel = collapseChannelsToFilterLabels(expanded);
  }

  return normalizeVdpFilters(filters);
}

export function parseInvRpcFromSearchParams(searchParams) {
  const years = searchParams.get('years')?.trim();
  const makes = searchParams.get('makes')?.trim();
  const models = searchParams.get('models')?.trim();
  const types = searchParams.get('types')?.trim();
  const locations = searchParams.get('locations')?.trim();
  const condition = searchParams.get('condition')?.trim()?.toUpperCase();
  const channels = searchParams.get('channels')?.trim();

  // Location names contain commas ("Jackson, TN"). Prefer | delimiter;
  // if no | present, treat the whole string as one location.
  const parseLocations = (raw) => {
    if (!raw) return undefined;
    if (raw.includes('|')) {
      return raw.split('|').map((s) => s.trim()).filter(Boolean);
    }
    return [raw.trim()];
  };

  const parseChannels = (raw) => {
    if (!raw) return undefined;
    return raw
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean);
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
    ...(parseChannels(channels) ? { p_channels: parseChannels(channels) } : {}),
  };
}
