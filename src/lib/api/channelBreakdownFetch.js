import { createClient } from '@/lib/supabase/client';
import { rpcByDateChunksProgressive } from '@/lib/api/chunkedRpc';
import { mergeChannelBreakdownRows } from '@/lib/ga4/channelBreakdownMerge';
import { BREAKDOWN_UI_CHUNK_DAYS } from '@/lib/api/rpcChunkPlan';
import {
  getChannelBreakdownCache,
  setChannelBreakdownCache,
} from '@/lib/data/channelBreakdownCache';
import {
  vdpRpcExtraParams,
  vdpFilterCacheSuffix,
} from '@/lib/vdp/vdpFilterParams';

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
    ...vdpRpcExtraParams(vdpFilters, tab),
  };

  const raw = await rpcByDateChunksProgressive(
    supabase,
    'get_ga4_channel_breakdown',
    {
      clientId,
      from,
      to,
      extraParams,
      chunkDays: BREAKDOWN_UI_CHUNK_DAYS,
      concurrency: 1,
      onCancelCheck,
      onBatch: (batchRows, meta) => {
        if (onCancelCheck?.()) return;
        const merged = mergeChannelBreakdownRows(batchRows);
        onProgress?.(merged, meta);
      },
    }
  );

  if (onCancelCheck?.()) return null;
  return mergeChannelBreakdownRows(raw || []);
}

/**
 * Fetch channel breakdown for ONE page type only (ALL | VDP | SRP | Home | Other).
 * Streams partial results every BREAKDOWN_UI_CHUNK_DAYS as chunks complete.
 */
export async function fetchChannelBreakdownBundle({
  clientId,
  from,
  to,
  pageTypeFilter = 'ALL',
  vdpFilters,
  tab = 'all',
  onCancelCheck,
  onProgress,
  skipCache = false,
}) {
  if (!clientId || !from || !to) return [];

  const cacheSuffix = vdpFilterCacheSuffix(vdpFilters, tab);

  if (!skipCache) {
    const cached = getChannelBreakdownCache(
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
  setChannelBreakdownCache(
    clientId,
    from,
    to,
    pageTypeFilter,
    rows,
    cacheSuffix
  );
  return rows;
}
