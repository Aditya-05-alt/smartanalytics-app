import { createClient } from '@/lib/supabase/client';
import { rpcByDateChunksProgressive } from '@/lib/api/chunkedRpc';
import { mergeChannelBreakdownRows } from '@/lib/ga4/channelBreakdownMerge';
import {
  BREAKDOWN_UI_CHUNK_DAYS,
  resolveRpcChunkPlan,
} from '@/lib/api/rpcChunkPlan';
import {
  getChannelBreakdownCache,
  setChannelBreakdownCache,
} from '@/lib/data/channelBreakdownCache';
import {
  appendVdpFiltersToSearchParams,
  channelBreakdownLabVdpFilters,
  channelBreakdownVdpFilters,
  channelFilterCacheSuffix,
  channelFilterLabCacheSuffix,
  channelFiltersActive,
  channelFiltersActiveLab,
  normalizeVdpFilters,
  vdpRpcExtraParams,
} from '@/lib/vdp/vdpFilterParams';
import { appendAnalyticsScope, scopeCacheId } from '@/lib/analytics/analyticsScope';

const LIVE_RPC = 'get_ga4_channel_breakdown';
const LAB_RPC = 'get_ga4_channel_breakdown_lab';

function resolveChannelFilterMode(vdpFilters, labMode) {
  if (labMode) {
    return {
      channelFilters: channelBreakdownLabVdpFilters(vdpFilters),
      filtersActive: channelFiltersActiveLab(vdpFilters, 'vdp'),
      cacheSuffix: channelFilterLabCacheSuffix(vdpFilters, 'vdp'),
      rpcName: LAB_RPC,
      apiPath: '/api/dashboard/channel-breakdown-lab',
    };
  }
  return {
    channelFilters: channelBreakdownVdpFilters(vdpFilters),
    filtersActive: channelFiltersActive(vdpFilters, 'vdp'),
    cacheSuffix: channelFilterCacheSuffix(vdpFilters, 'vdp'),
    rpcName: LIVE_RPC,
    apiPath: '/api/dashboard/channel-breakdown',
  };
}

async function fetchChannelBreakdownViaApi({
  clientId,
  from,
  to,
  pageTypeFilter,
  vdpFilters,
  tab,
  labMode = false,
  ga4PropertyId,
  onCancelCheck,
}) {
  if (typeof window === 'undefined') return null;
  if (onCancelCheck?.()) return null;

  const { channelFilters, apiPath } = resolveChannelFilterMode(vdpFilters, labMode);

  const qs = appendAnalyticsScope(
    new URLSearchParams({
      clientId,
      from,
      to,
      pageType: pageTypeFilter,
    }),
    { ga4PropertyId }
  );
  appendVdpFiltersToSearchParams(qs, channelFilters, tab);

  const res = await fetch(`${apiPath}?${qs}`, {
    credentials: 'same-origin',
  });
  const json = await res.json().catch(() => ({}));

  if (onCancelCheck?.()) return null;
  if (!res.ok) {
    if (res.status === 503) return null;
    throw new Error(json.error || `Channel breakdown request failed (${res.status})`);
  }

  return json.rows || [];
}

async function fetchViaClientProgressive({
  clientId,
  from,
  to,
  pageTypeFilter,
  vdpFilters,
  tab,
  labMode = false,
  onCancelCheck,
  onProgress,
  chunkDays,
  concurrency,
  adaptiveChunks = false,
}) {
  const supabase = createClient();
  if (!supabase) throw new Error('Supabase is not configured.');

  const { channelFilters, filtersActive, rpcName } = resolveChannelFilterMode(
    vdpFilters,
    labMode
  );
  const extraParams = {
    p_page_type: pageTypeFilter,
    ...vdpRpcExtraParams(channelFilters, tab),
  };

  let resolvedChunkDays = chunkDays ?? BREAKDOWN_UI_CHUNK_DAYS;
  let resolvedConcurrency = concurrency ?? 1;
  if (adaptiveChunks) {
    const plan = resolveRpcChunkPlan(from, to, {
      invFilters: filtersActive,
      pageType: pageTypeFilter,
    });
    resolvedChunkDays = chunkDays ?? plan.chunkDays;
    resolvedConcurrency = concurrency ?? plan.concurrency;
  }

  const raw = await rpcByDateChunksProgressive(supabase, rpcName, {
    clientId,
    from,
    to,
    extraParams,
    chunkDays: resolvedChunkDays,
    concurrency: resolvedConcurrency,
    onCancelCheck,
    onBatch: (batchRows, meta) => {
      if (onCancelCheck?.()) return;
      const merged = mergeChannelBreakdownRows(batchRows);
      onProgress?.(merged, meta);
    },
  });

  if (onCancelCheck?.()) return null;
  return mergeChannelBreakdownRows(raw || []);
}

/**
 * Fetch channel breakdown for ONE page type only (ALL | VDP | SRP | Home | Other).
 * Live + Lab: full inventory filters including location.
 * Both use adaptive date chunking; Lab hits channel-breakdown-lab API.
 */
export async function fetchChannelBreakdownBundle({
  clientId,
  from,
  to,
  pageTypeFilter = 'ALL',
  vdpFilters,
  tab = 'all',
  labMode = false,
  ga4PropertyId,
  onCancelCheck,
  onProgress,
  skipCache = false,
  preferServer = true,
  adaptiveChunks = false,
  chunkDays,
  concurrency,
}) {
  if (!clientId || !from || !to) return [];

  const cacheClientId = scopeCacheId(clientId, ga4PropertyId) || clientId;
  const { cacheSuffix } = resolveChannelFilterMode(vdpFilters, labMode);
  const cacheTab = labMode ? 'vdp' : tab;

  // Lab: prefer server API (service role). Still chunked like live.
  if (labMode) {
    preferServer = true;
    adaptiveChunks = true;
  }

  if (!skipCache) {
    const cached = getChannelBreakdownCache(
      cacheClientId,
      from,
      to,
      pageTypeFilter,
      cacheSuffix
    );
    if (cached) {
      onProgress?.(cached, { completed: 1, total: 1, fromCache: true });
      return cached;
    }
  }

  if (preferServer) {
    try {
      const viaApi = await fetchChannelBreakdownViaApi({
        clientId,
        from,
        to,
        pageTypeFilter,
        vdpFilters,
        tab: cacheTab,
        labMode,
        ga4PropertyId,
        onCancelCheck,
      });
      if (viaApi != null) {
        onProgress?.(viaApi, { completed: 1, total: 1, fromServer: true });
        const locActive = normalizeVdpFilters(vdpFilters).location.length > 0;
        // Don't cache empty results when location is set — avoids sticky 0 after RPC fix
        if (!skipCache && !(locActive && viaApi.length === 0)) {
          setChannelBreakdownCache(
            cacheClientId,
            from,
            to,
            pageTypeFilter,
            viaApi,
            cacheSuffix
          );
        }
        return viaApi;
      }
    } catch (err) {
      if (onCancelCheck?.()) return null;
      // Fall through to client-side chunked fetch.
    }
  }

  const result = await fetchViaClientProgressive({
    clientId,
    from,
    to,
    pageTypeFilter,
    vdpFilters,
    tab: cacheTab,
    labMode,
    onCancelCheck,
    onProgress,
    chunkDays,
    concurrency,
    adaptiveChunks,
  });

  if (onCancelCheck?.()) return null;
  const rows = result || [];
  setChannelBreakdownCache(
    cacheClientId,
    from,
    to,
    pageTypeFilter,
    rows,
    cacheSuffix
  );
  return rows;
}
