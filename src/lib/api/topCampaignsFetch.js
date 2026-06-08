import { createClient } from '@/lib/supabase/client';
import { rpcByDateChunks } from '@/lib/api/chunkedRpc';
import { mergeTopCampaignRows } from '@/lib/ga4/topCampaignsMerge';
import { resolveRpcChunkPlan } from '@/lib/api/rpcChunkPlan';
import {
  getTopCampaignsCache,
  setTopCampaignsCache,
} from '@/lib/data/topCampaignsCache';
import {
  vdpFiltersActive,
  vdpRpcExtraParams,
  vdpFilterCacheSuffix,
  appendVdpFiltersToSearchParams,
} from '@/lib/vdp/vdpFilterParams';

async function fetchViaApi({
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
    throw new Error(json.error || `Top campaigns failed (${res.status})`);
  }

  return json.rows || [];
}

async function fetchViaClient({
  clientId,
  from,
  to,
  pageTypeFilter,
  vdpFilters,
  tab,
  onCancelCheck,
}) {
  const supabase = createClient();
  if (!supabase) throw new Error('Supabase is not configured.');

  const invActive = vdpFiltersActive(vdpFilters, tab);
  const { chunkDays, concurrency } = resolveRpcChunkPlan(from, to, {
    invFilters: invActive,
  });

  const raw = await rpcByDateChunks(supabase, 'get_top_campaigns', {
    clientId,
    from,
    to,
    extraParams: {
      p_page_type: pageTypeFilter,
      p_limit: null,
      ...vdpRpcExtraParams(vdpFilters, tab),
    },
    chunkDays,
    concurrency,
    onCancelCheck,
  });

  if (onCancelCheck?.()) return null;
  return mergeTopCampaignRows(raw);
}

export async function fetchTopCampaignsBundle({
  clientId,
  from,
  to,
  pageTypeFilter = 'ALL',
  vdpFilters,
  tab = 'all',
  onCancelCheck,
  skipCache = false,
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
    if (cached) return cached;
  }

  const fetchOpts = {
    clientId,
    from,
    to,
    pageTypeFilter,
    vdpFilters,
    tab,
    onCancelCheck,
  };

  let rows;
  try {
    rows = await fetchViaApi(fetchOpts);
    if (rows == null) {
      rows = await fetchViaClient(fetchOpts);
    }
  } catch (err) {
    if (onCancelCheck?.()) return null;
    rows = await fetchViaClient(fetchOpts);
    if (rows == null) throw err;
  }

  if (onCancelCheck?.()) return null;
  const result = rows || [];
  setTopCampaignsCache(
    clientId,
    from,
    to,
    pageTypeFilter,
    result,
    cacheSuffix
  );
  return result;
}
