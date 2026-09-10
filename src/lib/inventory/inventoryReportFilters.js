export const DEFAULT_INVENTORY_FILTERS = {
  year: [],
  condition: [],
  make: [],
  model: [],
  type: [],
  location: [],
};

export const INVENTORY_CONDITION_OPTIONS = [
  { value: 'All', label: 'All Conditions' },
  { value: 'Used', label: 'Used' },
  { value: 'New', label: 'New' },
];

const STATIC_YEARS = ['2026', '2025', '2024', '2023', '2022', '2021', '2020'];
const STATIC_MAKES = [
  'Harley-Davidson',
  'Honda',
  'Toyota',
  'Ford',
  'Polaris',
  'Yamaha',
];
const STATIC_MODELS = [
  'Sportster',
  'Road Glide',
  'Civic',
  'F-150',
  'Ranger',
  'CRF',
];
const STATIC_LOCATIONS = ['Main Lot', 'Remote Lot', 'Showroom'];

function selectedValues(value) {
  if (value == null || value === 'All' || value === '' || value === 'Used + New') {
    return [];
  }
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

function conditionToRpc(condition) {
  const list = selectedValues(condition).map((c) => c.toLowerCase());
  const wantsNew = list.some((c) => c === 'new');
  const wantsUsed = list.some((c) => c === 'used');
  if (wantsNew && !wantsUsed) return 'NEW';
  if (wantsUsed && !wantsNew) return 'USED';
  return 'BOTH';
}

export function normalizeInventoryFilters(input) {
  const merged = { ...DEFAULT_INVENTORY_FILTERS, ...(input || {}) };
  return {
    ...merged,
    // Year / model not exposed in inventory UI yet — keep cleared.
    year: [],
    model: [],
    condition: selectedValues(merged.condition),
    make: selectedValues(merged.make),
    type: selectedValues(merged.type),
    location: selectedValues(merged.location),
  };
}

export function inventoryFiltersActive(filters) {
  const f = normalizeInventoryFilters(filters);
  return (
    f.condition.length > 0
    || f.make.length > 0
    || f.type.length > 0
    || f.location.length > 0
  );
}

export function toFilterOpts(values, allLabel) {
  return (values || ['All']).map((v) => ({
    value: v,
    label: v === 'All' ? allLabel : v,
  }));
}

/** Map inventory UI filters → con_inv_breakdown RPC params. */
export function inventoryFiltersToRpcParams(filters) {
  const f = normalizeInventoryFilters(filters);
  const params = { p_condition: conditionToRpc(f.condition) };

  if (f.make.length) params.p_makes = f.make;
  if (f.type.length) params.p_types = f.type;
  if (f.location.length) params.p_locations = f.location;

  return params;
}

export function buildInventoryFilterOptions(config = {}) {
  const typeList = config.types?.length ? config.types : [
    'Motorcycle',
    'ATV',
    'UTV',
    'Marine',
  ];

  return {
    years: ['All', ...STATIC_YEARS],
    makes: ['All', ...STATIC_MAKES],
    models: ['All', ...STATIC_MODELS],
    types: ['All', ...typeList],
    locations: ['All', ...STATIC_LOCATIONS],
  };
}

/** Map RPC filterOptions json → UI dropdown values (with leading All). */
export function filterOptionsFromRpc(rpcOptions) {
  if (!rpcOptions || typeof rpcOptions !== 'object') return null;

  const withAll = (values) => {
    const list = Array.isArray(values)
      ? values.map((v) => String(v)).filter(Boolean)
      : [];
    return ['All', ...list];
  };

  return {
    years: withAll(rpcOptions.years),
    makes: withAll(rpcOptions.makes),
    models: withAll(rpcOptions.models),
    types: withAll(rpcOptions.types),
    locations: withAll(rpcOptions.locations),
  };
}

export function mergeInventoryFilterOptions(rpcOptions, config = {}) {
  const fallback = buildInventoryFilterOptions(config);
  if (!rpcOptions) return fallback;

  const merge = (rpcList, fallbackList) => {
    const set = new Set(
      [...(rpcList || []), ...(fallbackList || [])].filter((v) => v && v !== 'All')
    );
    return ['All', ...[...set].sort()];
  };

  return {
    years: merge(rpcOptions.years, fallback.years),
    makes: merge(rpcOptions.makes, fallback.makes),
    models: merge(rpcOptions.models, fallback.models),
    types: merge(rpcOptions.types, fallback.types),
    locations: merge(rpcOptions.locations, fallback.locations),
  };
}
