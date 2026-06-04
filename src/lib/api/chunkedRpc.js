import { chunkDateRangesInclusive } from '@/lib/ga4/dateRange';

export const RPC_CHUNK_DAYS = 5;
export const RPC_CHUNK_CONCURRENCY = 3;

export function isStatementTimeoutError(error) {
  const msg = error?.message || '';
  return error?.code === '57014' || /timeout|canceling statement/i.test(msg);
}

function rpcParams(clientId, from, to, extra = {}) {
  return {
    p_client_id: String(clientId).trim(),
    p_from: String(from).slice(0, 10),
    p_to: String(to).slice(0, 10),
    ...extra,
  };
}

/**
 * Run a date-range RPC in small windows (avoids Postgres statement_timeout).
 */
export async function rpcByDateChunks(
  supabase,
  rpcName,
  {
    clientId,
    from,
    to,
    extraParams = {},
    chunkDays = RPC_CHUNK_DAYS,
    concurrency = RPC_CHUNK_CONCURRENCY,
    onCancelCheck,
  } = {}
) {
  if (!clientId || !from || !to) return [];
  if (onCancelCheck?.()) return null;

  const ranges = chunkDateRangesInclusive(from, to, chunkDays);
  if (!ranges.length) return [];

  if (ranges.length === 1) {
    const { data, error } = await supabase.rpc(rpcName, rpcParams(clientId, from, to, extraParams));
    if (error) throw error;
    return data || [];
  }

  const merged = [];
  for (let i = 0; i < ranges.length; i += concurrency) {
    if (onCancelCheck?.()) return null;
    const batch = ranges.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map((range) =>
        supabase.rpc(rpcName, rpcParams(clientId, range.from, range.to, extraParams))
      )
    );
    for (const { data, error } of results) {
      if (error) throw error;
      if (data?.length) merged.push(...data);
    }
  }
  return merged;
}
