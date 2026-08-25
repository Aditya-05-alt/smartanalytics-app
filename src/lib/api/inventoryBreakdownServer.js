import { rpcByDateChunks } from '@/lib/api/chunkedRpc';
import { mergeInventoryBreakdownRows } from '@/lib/api/inventoryBreakdownMerge';
import { resolveRpcChunkPlan } from '@/lib/api/rpcChunkPlan';
import { mergeAnalyticsExtra } from '@/lib/api/analyticsScope';
import { parseInvRpcFromSearchParams } from '@/lib/vdp/vdpFilterParams';

/**
 * Shared server-side chunked inventory breakdown (location, make, type, …).
 */
export async function runChunkedInventoryBreakdown(
  supabase,
  searchParams,
  { rpcName, fallbackRpc, bucketKey, secondaryBucketKey = null }
) {
  const clientId = searchParams.get('clientId')?.trim();
  const from = searchParams.get('from')?.slice(0, 10);
  const to = searchParams.get('to')?.slice(0, 10);
  const inv = parseInvRpcFromSearchParams(searchParams);
  const invFilters = Boolean(
    inv.p_years?.length ||
      inv.p_makes?.length ||
      inv.p_models?.length ||
      inv.p_types?.length ||
      inv.p_locations?.length ||
      inv.p_channels?.length ||
      (inv.p_condition && inv.p_condition !== 'BOTH')
  );

  const extraParams = mergeAnalyticsExtra(searchParams, {
    p_limit: null,
    ...inv,
  });

  const { chunkDays, concurrency } = resolveRpcChunkPlan(from, to, {
    invFilters,
    pageType: 'VDP',
  });

  let raw;
  try {
    raw = await rpcByDateChunks(supabase, rpcName, {
      clientId,
      from,
      to,
      extraParams,
      chunkDays,
      concurrency,
    });
  } catch (err) {
    if (!fallbackRpc) throw err;
    raw = await rpcByDateChunks(supabase, fallbackRpc, {
      clientId,
      from,
      to,
      extraParams,
      chunkDays,
      concurrency,
    });
  }

  return mergeInventoryBreakdownRows(raw, bucketKey, secondaryBucketKey);
}
