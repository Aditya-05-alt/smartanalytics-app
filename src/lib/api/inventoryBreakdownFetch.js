import { createClient } from '@/lib/supabase/client';
import { rpcByDateChunksProgressive } from '@/lib/api/chunkedRpc';
import { resolveRpcChunkPlan } from '@/lib/api/rpcChunkPlan';
import { appendAnalyticsScope, isPropertyScoped, withPropertyRpcParams } from '@/lib/analytics/analyticsScope';
import {
  appendInvParamsToSearchParams,
  channelFiltersActive,
  vdpRpcExtraParams,
} from '@/lib/vdp/vdpFilterParams';
import { mergeInventoryBreakdownRows } from '@/lib/api/inventoryBreakdownMerge';

function isMissingRpcError(error) {
  const msg = String(error?.message ?? error ?? '');
  return /function.*does not exist|could not find the function|schema cache/i.test(msg);
}

async function fetchInventoryBreakdownViaApi({
  apiPath,
  clientId,
  from,
  to,
  ga4PropertyId,
  vdpFilters,
  tab,
  onCancelCheck,
}) {
  if (typeof window === 'undefined') return null;
  if (onCancelCheck?.()) return null;

  const qs = appendAnalyticsScope(
    new URLSearchParams({
      clientId: String(clientId).trim(),
      from: String(from).slice(0, 10),
      to: String(to).slice(0, 10),
    }),
    { ga4PropertyId }
  );
  appendInvParamsToSearchParams(qs, vdpRpcExtraParams(vdpFilters, tab));

  const res = await fetch(`${apiPath}?${qs}`, { credentials: 'same-origin' });
  const json = await res.json().catch(() => ({}));

  if (onCancelCheck?.()) return null;
  if (!res.ok) {
    throw new Error(json.error || `Request failed (${res.status})`);
  }

  return json.data ?? [];
}

/**
 * Chunked inventory breakdown (location, make, type, …) — same strategy as channel breakdown.
 */
export async function fetchInventoryBreakdownChunked({
  clientId,
  from,
  to,
  limit = null,
  vdpFilters,
  tab = 'vdp',
  ga4PropertyId,
  onCancelCheck,
  onProgress,
  rpcName,
  fallbackRpc = null,
  apiPath = null,
  bucketKey,
  secondaryBucketKey = null,
  labMode = false,
}) {
  if (!clientId || !from || !to) return [];
  if (onCancelCheck?.()) return null;

  const invFilters = channelFiltersActive(vdpFilters, tab);
  const extraParams = withPropertyRpcParams(
    {
      p_limit: null,
      ...vdpRpcExtraParams(vdpFilters, tab),
    },
    ga4PropertyId
  );

  const { chunkDays, concurrency } = resolveRpcChunkPlan(from, to, {
    invFilters,
    pageType: 'VDP',
  });

  const finalize = (rawRows) =>
    mergeInventoryBreakdownRows(rawRows, bucketKey, secondaryBucketKey, limit);

  if (apiPath) {
    try {
      const viaApi = await fetchInventoryBreakdownViaApi({
        apiPath,
        clientId,
        from,
        to,
        ga4PropertyId,
        vdpFilters,
        tab,
        onCancelCheck,
      });
      if (onCancelCheck?.()) return null;
      if (viaApi != null) {
        const rows = finalize(viaApi);
        onProgress?.(rows, { completed: 1, total: 1, fromServer: true });
        return rows;
      }
    } catch (err) {
      if (onCancelCheck?.()) return null;
      // Fall through to client-side chunked RPC when the server route is unavailable.
      console.warn(`[inventory-breakdown] ${apiPath} failed, using chunked client RPC`, err);
    }
  }

  const supabase = createClient();
  if (!supabase) throw new Error('Supabase is not configured.');

  const merged = [];

  let raw;
  try {
    raw = await rpcByDateChunksProgressive(supabase, rpcName, {
      clientId,
      from,
      to,
      extraParams,
      chunkDays,
      concurrency,
      onCancelCheck,
      onBatch: (batch, meta) => {
        if (onCancelCheck?.()) return;
        merged.length = 0;
        merged.push(...batch);
        onProgress?.(finalize(merged), meta);
      },
    });
  } catch (err) {
    if (isPropertyScoped(ga4PropertyId) && isMissingRpcError(err)) return [];
    if (fallbackRpc && rpcName !== fallbackRpc) {
      try {
        raw = await rpcByDateChunksProgressive(supabase, fallbackRpc, {
          clientId,
          from,
          to,
          extraParams,
          chunkDays,
          concurrency,
          onCancelCheck,
          onBatch: (batch, meta) => {
            if (onCancelCheck?.()) return;
            merged.length = 0;
            merged.push(...batch);
            onProgress?.(finalize(merged), meta);
          },
        });
      } catch (fallbackErr) {
        if (isPropertyScoped(ga4PropertyId) && isMissingRpcError(fallbackErr)) return [];
        throw fallbackErr;
      }
    } else {
      throw err;
    }
  }

  if (onCancelCheck?.()) return null;

  if (raw?.length) {
    return finalize(raw);
  }

  return [];
}
