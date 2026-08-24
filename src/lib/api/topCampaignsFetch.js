import { createClient } from '@/lib/supabase/client';
import { rpcByDateChunksProgressive } from '@/lib/api/chunkedRpc';
import { mergeTopCampaignRows } from '@/lib/ga4/topCampaignsMerge';
import { BREAKDOWN_UI_CHUNK_DAYS } from '@/lib/api/rpcChunkPlan';
import {
  getTopCampaignsCache,
  setTopCampaignsCache,
} from '@/lib/data/topCampaignsCache';
import {
  appendVdpFiltersToSearchParams,
  vdpRpcExtraParams,
  vdpFilterCacheSuffix,
} from '@/lib/vdp/vdpFilterParams';

async function fetchTopCampaignsViaApi({
  clientId,
  from,
  to,
  pageTypeFilter,
  vdpFilters,
  tab,
  onCancelCheck,
}) {
  if (typeof window === 'undefined') return null;
  if (onCancelCheck?.()) return null;

  const qs = new URLSearchParams({
    clientId,
    from,
    to,
    pageType: pageTypeFilter,
  });
  appendVdpFiltersToSearchParams(qs, vdpFilters, tab);

  const res = await fetch(`/api/dashboard/top-campaigns?${qs}`, {
    credentials: 'same-origin',
  });
  const json = await res.json().catch(() => ({}));

  if (onCancelCheck?.()) return null;
  if (!res.ok) {
    if (res.status === 503) return null;
    throw new Error(json.error || `Top campaigns request failed (${res.status})`);
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
  onCancelCheck,
  onProgress,
}) {
  const supabase = createClient();
  if (!supabase) throw new Error('Supabase is not configured.');

  const extraParams = {
    p_page_type: pageTypeFilter,
    p_limit: null,
    ...vdpRpcExtraParams(vdpFilters, tab),
  };

  const raw = await rpcByDateChunksProgressive(supabase, 'get_top_campaigns', {
    clientId,
    from,
    to,
    extraParams,
    chunkDays: BREAKDOWN_UI_CHUNK_DAYS,
    concurrency: 1,
    onCancelCheck,
    onBatch: (batchRows, meta) => {
      if (onCancelCheck?.()) return;
      const merged = mergeTopCampaignRows(batchRows);
      onProgress?.(merged, meta);
    },
  });

  if (onCancelCheck?.()) return null;
  return mergeTopCampaignRows(raw || []);
}

/**
 * Fetch top campaigns for ONE page type only (ALL | VDP | SRP | Home | Other).
 * Prefers server API (service role); falls back to SECURITY DEFINER RPC.
 */
export async function fetchTopCampaignsBundle({
  clientId,
  from,
  to,
  pageTypeFilter = 'ALL',
  vdpFilters,
  tab = 'all',
  onCancelCheck,
  onProgress,
  skipCache = false,
  preferServer = true,
}) {
  if (!clientId || !from || !to) return [];

  const cacheSuffix = vdpFilterCacheSuffix(vdpFilters, tab);

  if (!skipCache) {
    const cached = getTopCampaignsCache(
      clientId,
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
      const viaApi = await fetchTopCampaignsViaApi({
        clientId,
        from,
        to,
        pageTypeFilter,
        vdpFilters,
        tab,
        onCancelCheck,
      });
      if (viaApi != null) {
        onProgress?.(viaApi, { completed: 1, total: 1, fromServer: true });
        const rows = viaApi || [];
        if (!skipCache) {
          setTopCampaignsCache(clientId, from, to, pageTypeFilter, rows, cacheSuffix);
        }
        return rows;
      }
    } catch (err) {
      if (onCancelCheck?.()) return null;
      // Fall through to RPC.
    }
  }

  const result = await fetchViaClientProgressive({
    clientId,
    from,
    to,
    pageTypeFilter,
    vdpFilters,
    tab,
    onCancelCheck,
    onProgress,
  });

  if (onCancelCheck?.()) return null;
  const rows = result || [];
  setTopCampaignsCache(clientId, from, to, pageTypeFilter, rows, cacheSuffix);
  return rows;
}
