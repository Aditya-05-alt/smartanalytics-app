import { createClient } from '@/lib/supabase/client';
import { fetchOverviewBundle } from '@/lib/api/overviewFetch';
import { sanitizeVdpLocationOptions } from '@/lib/vdp/locationFilterOptions';
import { fetchChannelBreakdownBundle } from '@/lib/api/channelBreakdownFetch';
import { fetchTopCampaignsBundle } from '@/lib/api/topCampaignsFetch';
import { fetchInventoryBreakdownChunked } from '@/lib/api/inventoryBreakdownFetch';
import { rpcByDateChunks } from '@/lib/api/chunkedRpc';
import { fetchVdpKpiFiltered } from '@/lib/api/vdpKpiFetch';
import {
  appendAnalyticsScope,
  isPropertyScoped,
  scopeCacheId,
  withPropertyRpcParams,
} from '@/lib/analytics/analyticsScope';
import {
  getVdpDailyCache,
  setVdpDailyCache,
} from '@/lib/data/vdpDailyCache';
import {
  vdpRpcExtraParams,
  vdpFiltersToRpcParams,
  vdpFilterCacheSuffix,
  appendVdpFiltersToSearchParams,
} from '@/lib/vdp/vdpFilterParams';

function isMissingRpcError(error) {
  const msg = String(error?.message ?? error ?? '');
  return /function.*does not exist|could not find the function|schema cache/i.test(msg);
}

/**
 * GA4 OVERVIEW API
 * ----------------
 * IMPORTANT: never sum total_users / sessions / new_users from smart_ga4_page_data —
 * those are session-scoped metrics that get inflated when joined with page dimensions.
 * Use smart_ga4_data for user/session totals via fetchUserTotals().
 * Use smart_ga4_page_data only for views and per-page aggregations.
 */
export async function fetchOverviewRows({ clientId, from, to, onCancelCheck }) {
  const bundle = await fetchOverviewBundle({ clientId, from, to, onCancelCheck });
  return bundle?.rows || [];
}

export async function fetchUserTotals({ clientId, from, to, onCancelCheck }) {
  const bundle = await fetchOverviewBundle({ clientId, from, to, onCancelCheck });
  return bundle?.userTotalsRows || [];
}

export async function fetchChannelBreakdown({
  clientId,
  from,
  to,
  pageTypeFilter = 'VDP',
  vdpFilters,
  tab = 'all',
  onCancelCheck,
}) {
  return fetchChannelBreakdownBundle({
    clientId,
    from,
    to,
    pageTypeFilter,
    vdpFilters,
    tab,
    onCancelCheck,
    preferServer: true,
  });
}

async function fetchVdpFilterOptionsViaApi({
  clientId,
  from,
  to,
  vdpFilters,
  tab,
  ga4PropertyId,
  onCancelCheck,
}) {
  if (typeof window === 'undefined') return null;
  if (onCancelCheck?.()) return null;

  const qs = appendAnalyticsScope(
    new URLSearchParams({
      clientId: String(clientId).trim(),
      from: toDateOnly(from),
      to: toDateOnly(to),
    }),
    { ga4PropertyId }
  );
  appendVdpFiltersToSearchParams(qs, vdpFilters, tab);

  const res = await fetch(`/api/dashboard/vdp-filter-options?${qs}`, {
    credentials: 'same-origin',
  });
  const json = await res.json().catch(() => ({}));

  if (onCancelCheck?.()) return null;
  if (!res.ok) {
    if (res.status === 503) return null;
    throw new Error(json.error || `VDP filter options request failed (${res.status})`);
  }

  return json;
}

/** Distinct VDP filter dropdown values for dealer + date range (cascades with active filters). */
export async function fetchVdpFilterOptions({
  clientId,
  from,
  to,
  vdpFilters,
  tab = 'vdp',
  ga4PropertyId,
  onCancelCheck,
}) {
  if (!clientId || !from || !to) return null;
  if (onCancelCheck?.()) return null;

  const invParams = vdpFiltersToRpcParams(vdpFilters, tab);

  try {
    const viaApi = await fetchVdpFilterOptionsViaApi({
      clientId,
      from,
      to,
      vdpFilters,
      tab,
      ga4PropertyId,
      onCancelCheck,
    });
    if (viaApi) {
      return {
        ...viaApi,
        locations: sanitizeVdpLocationOptions(viaApi.locations, {
          configured: viaApi.configured_locations,
        }),
      };
    }
  } catch {
    // fall through to direct RPC
  }

  const supabase = createClient();
  if (!supabase) throw new Error('Supabase is not configured.');
  if (onCancelCheck?.()) return null;

  const { data, error } = await supabase.rpc(
    'get_vdp_filter_options',
    withPropertyRpcParams(
      {
        p_client_id: String(clientId).trim(),
        p_from: toDateOnly(from),
        p_to: toDateOnly(to),
        p_types: invParams.p_types ?? null,
        p_makes: invParams.p_makes ?? null,
        p_models: invParams.p_models ?? null,
        p_locations: invParams.p_locations ?? null,
        p_years: invParams.p_years ?? null,
        p_condition: invParams.p_condition ?? 'BOTH',
        p_channels: invParams.p_channels ?? null,
      },
      ga4PropertyId
    )
  );

  if (error) throw new Error(error.message || 'Failed to load VDP filter options.');

  const row = Array.isArray(data) ? data[0] : data;
  const asList = (key) => {
    const raw = row?.[key];
    return Array.isArray(raw) ? raw.filter(Boolean) : [];
  };

  return {
    years: ['All', ...asList('years')],
    makes: ['All', ...asList('makes')],
    models: ['All', ...asList('models')],
    locations: sanitizeVdpLocationOptions(['All', ...asList('locations')], {
      configured: asList('configured_locations'),
    }),
    types: ['All', ...asList('types')],
  };
}

async function fetchVdpDailyFilteredViaApi({
  clientId,
  from,
  to,
  vdpFilters,
  tab,
  ga4PropertyId,
  onCancelCheck,
}) {
  if (typeof window === 'undefined') return null;
  if (onCancelCheck?.()) return null;

  const qs = appendAnalyticsScope(
    new URLSearchParams({
      clientId: String(clientId).trim(),
      from: toDateOnly(from),
      to: toDateOnly(to),
    }),
    { ga4PropertyId }
  );
  appendVdpFiltersToSearchParams(qs, vdpFilters, tab);

  const res = await fetch(`/api/dashboard/vdp-daily?${qs}`, { credentials: 'same-origin' });
  const json = await res.json().catch(() => ({}));

  if (onCancelCheck?.()) return null;
  if (!res.ok) {
    if (res.status === 503) return null;
    throw new Error(json.error || `VDP daily request failed (${res.status})`);
  }

  return {
    daily: json.daily || {},
    total: Number(json.total) || 0,
  };
}

/** Daily VDP views from smart_final_data (combined inventory filters). */
export async function fetchVdpDailyFiltered({
  clientId,
  from,
  to,
  vdpFilters,
  tab = 'vdp',
  ga4PropertyId,
  onCancelCheck,
  onProgress,
  skipCache = false,
}) {
  if (!clientId || !from || !to) return null;
  if (onCancelCheck?.()) return null;

  const cacheKey = scopeCacheId(clientId, ga4PropertyId);
  const cacheSuffix = vdpFilterCacheSuffix(vdpFilters, tab);

  if (!skipCache) {
    const cached = getVdpDailyCache(cacheKey, from, to, cacheSuffix);
    if (cached) {
      onProgress?.(cached, { completed: 1, total: 1, fromCache: true });
      return cached;
    }
  }

  const inv = vdpRpcExtraParams(vdpFilters, tab);

  // Service-role API first (RLS-safe after smart_ga4_page_data is locked down).
  try {
    const viaApi = await fetchVdpDailyFilteredViaApi({
      clientId,
      from,
      to,
      vdpFilters,
      tab,
      ga4PropertyId,
      onCancelCheck,
    });
    if (viaApi) {
      onProgress?.(viaApi, { completed: 1, total: 1, fromServer: true });
      if (!skipCache) {
        setVdpDailyCache(cacheKey, from, to, cacheSuffix, viaApi);
      }
      return viaApi;
    }
  } catch {
    // fall through to direct RPC
  }

  const supabase = createClient();
  if (supabase) {
    try {
      const result = await fetchVdpKpiFiltered(supabase, {
        clientId,
        from,
        to,
        invParams: inv,
        ga4PropertyId,
        onCancelCheck,
        onProgress,
      });

      if (onCancelCheck?.()) return null;
      if (result) {
        if (!skipCache) {
          setVdpDailyCache(cacheKey, from, to, cacheSuffix, result);
        }
        return result;
      }
    } catch {
      // fall through to server API
    }
  }

  try {
    const viaApi = await fetchVdpDailyFilteredViaApi({
      clientId,
      from,
      to,
      vdpFilters,
      tab,
      ga4PropertyId,
      onCancelCheck,
    });
    if (viaApi) {
      onProgress?.(viaApi, { completed: 1, total: 1, fromServer: true });
      if (!skipCache) {
        setVdpDailyCache(cacheKey, from, to, cacheSuffix, viaApi);
      }
      return viaApi;
    }
  } catch {
    // exhausted fallbacks
  }

  throw new Error('Failed to load VDP daily views.');
}

/** @deprecated use fetchVdpDailyFiltered */
export async function fetchVdpDailyByYear(opts) {
  return fetchVdpDailyFiltered(opts);
}

/** Make breakdown from smart_final_data (VDP tab only). */
export async function fetchMakeBreakdown({
  clientId,
  from,
  to,
  limit = null,
  vdpFilters,
  tab = 'vdp',
  ga4PropertyId,
  onCancelCheck,
  onProgress,
}) {
  if (onCancelCheck?.()) return null;
  return fetchInventoryBreakdownChunked({
    clientId,
    from,
    to,
    limit,
    vdpFilters,
    tab,
    ga4PropertyId,
    onCancelCheck,
    onProgress,
    rpcName: 'get_make_breakdown',
    bucketKey: 'make_bucket',
  });
}

/** VDP page title × channel matrix (Top 5 / Top 10 / All). */
export async function fetchVdpPageTitleByChannel({
  clientId,
  from,
  to,
  limit = 10,
  vdpFilters,
  tab = 'vdp',
  ga4PropertyId,
  onCancelCheck,
}) {
  const supabase = createClient();
  if (!supabase) throw new Error('Supabase is not configured.');
  if (onCancelCheck?.()) return null;

  const params = withPropertyRpcParams(
    {
      p_client_id: String(clientId).trim(),
      p_from: toDateOnly(from),
      p_to: toDateOnly(to),
      p_limit: limit,
      ...vdpRpcExtraParams(vdpFilters, tab),
    },
    ga4PropertyId
  );

  const { data, error } = await supabase.rpc('get_vdp_page_title_by_channel', params);

  if (error) {
    if (isPropertyScoped(ga4PropertyId) && isMissingRpcError(error)) return [];
    throw new Error(error.message || 'Failed to fetch VDP page title channels.');
  }
  return data || [];
}

/** Type breakdown from smart_final_data (VDP tab only). */
export async function fetchTypeBreakdown({
  clientId,
  from,
  to,
  limit = null,
  vdpFilters,
  tab = 'vdp',
  ga4PropertyId,
  onCancelCheck,
  onProgress,
}) {
  if (onCancelCheck?.()) return null;
  return fetchInventoryBreakdownChunked({
    clientId,
    from,
    to,
    limit,
    vdpFilters,
    tab,
    ga4PropertyId,
    onCancelCheck,
    onProgress,
    rpcName: 'get_type_breakdown',
    bucketKey: 'type_bucket',
  });
}

/** Model breakdown from smart_final_data (VDP tab only). */
export async function fetchModelBreakdown({
  clientId,
  from,
  to,
  limit = null,
  vdpFilters,
  tab = 'vdp',
  ga4PropertyId,
  onCancelCheck,
  onProgress,
}) {
  if (onCancelCheck?.()) return null;
  const rows = await fetchInventoryBreakdownChunked({
    clientId,
    from,
    to,
    limit,
    vdpFilters,
    tab,
    ga4PropertyId,
    onCancelCheck,
    onProgress,
    rpcName: 'get_model_breakdown',
    bucketKey: 'model_bucket',
    secondaryBucketKey: 'make_bucket',
  });
  return Array.isArray(rows) ? rows : rows ? [rows] : [];
}

/** Year breakdown from smart_final_data (VDP tab only). */
export async function fetchYearBreakdown({
  clientId,
  from,
  to,
  limit = null,
  vdpFilters,
  tab = 'vdp',
  ga4PropertyId,
  onCancelCheck,
  onProgress,
}) {
  if (onCancelCheck?.()) return null;
  return fetchInventoryBreakdownChunked({
    clientId,
    from,
    to,
    limit,
    vdpFilters,
    tab,
    ga4PropertyId,
    onCancelCheck,
    onProgress,
    rpcName: 'get_year_breakdown',
    bucketKey: 'year_bucket',
  });
}

/** Condition breakdown from smart_final_data (VDP tab only). */
export async function fetchConditionBreakdown({
  clientId,
  from,
  to,
  limit = null,
  vdpFilters,
  tab = 'vdp',
  ga4PropertyId,
  onCancelCheck,
  onProgress,
}) {
  if (onCancelCheck?.()) return null;
  return fetchInventoryBreakdownChunked({
    clientId,
    from,
    to,
    limit,
    vdpFilters,
    tab,
    ga4PropertyId,
    onCancelCheck,
    onProgress,
    rpcName: 'get_condition_breakdown',
    bucketKey: 'condition_bucket',
  });
}

/** All campaigns by views from smart_ga4_page_data (merged across date chunks). */
export async function fetchTopCampaigns({
  clientId,
  from,
  to,
  pageTypeFilter = 'ALL',
  vdpFilters,
  tab = 'all',
  onCancelCheck,
}) {
  return fetchTopCampaignsBundle({
    clientId,
    from,
    to,
    pageTypeFilter,
    vdpFilters,
    tab,
    onCancelCheck,
  });
}

function toDateOnly(value) {
  if (!value) return value;
  return String(value).slice(0, 10);
}

function normalizeLocationRows(data) {
  const list = Array.isArray(data) ? data : data ? [data] : [];
  return list.map((row) => ({
    location_bucket: String(
      row.location_bucket ?? row.location ?? row.inv_location ?? ''
    ),
    views: Number(row.views ?? row.view_count ?? 0) || 0,
    pct: Number(row.pct ?? row.percentage ?? 0) || 0,
    rank: Number(row.rank ?? row.rn ?? 999) || 999,
  }));
}

/**
 * Location breakdown — date-chunked (server API first, then client chunked RPC).
 */
export async function fetchLocationBreakdown({
  clientId,
  from,
  to,
  limit = null,
  vdpFilters,
  tab = 'vdp',
  labMode = false,
  ga4PropertyId,
  onCancelCheck,
  onProgress,
}) {
  if (onCancelCheck?.()) return undefined;

  const rows = await fetchInventoryBreakdownChunked({
    clientId,
    from,
    to,
    limit,
    vdpFilters,
    tab,
    ga4PropertyId,
    onCancelCheck,
    onProgress,
    rpcName: labMode ? 'get_dealer_location_breakdown_lab' : 'get_dealer_location_breakdown',
    fallbackRpc: labMode ? 'get_location_breakdown_lab' : 'get_location_breakdown',
    apiPath: labMode
      ? '/api/dashboard/location-breakdown-lab'
      : '/api/dashboard/location-breakdown',
    bucketKey: 'location_bucket',
    labMode,
  });

  if (onCancelCheck?.()) return undefined;
  if (rows == null) return undefined;
  return normalizeLocationRows(rows);
}

/** Active dealers from smart_hoot_config (same source as ClientContext). */
export async function fetchActiveDealers() {
  const supabase = createClient();
  if (!supabase) throw new Error('Supabase is not configured.');

  const { data, error } = await supabase
    .from('smart_hoot_config')
    .select(
      'id, customer_name, hoot_id, hoot_url, ga4_customer_id, website_platform, is_active'
    )
    .eq('is_active', true)
    .order('customer_name', { ascending: true });

  if (error) throw new Error(error.message || 'Failed to load dealers.');

  return (data || [])
    .filter((r) => r && r.customer_name)
    .map((row) => ({
      id: row.id,
      name: row.customer_name || 'Unnamed dealer',
      ga4CustomerId: row.ga4_customer_id || null,
      hootId: row.hoot_id || null,
      websitePlatform: row.website_platform || null,
    }));
}
