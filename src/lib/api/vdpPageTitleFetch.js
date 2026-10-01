import { createClient } from '@/lib/supabase/client';
import { rpcByDateChunksProgressive } from '@/lib/api/chunkedRpc';
import { isPropertyScoped, withPropertyRpcParams } from '@/lib/analytics/analyticsScope';
import { vdpRpcExtraParams } from '@/lib/vdp/vdpFilterParams';

const CHUNK_RPC = 'get_vdp_page_title_channel_chunk';
const LEGACY_RPC = 'get_vdp_page_title_by_channel';
// Cold-cache 5-day windows on heavy dealers reach the 8s authenticated statement_timeout.
const CHUNK_DAYS = 3;
const CHUNK_CONCURRENCY = 3;

const SUM_KEYS = [
  'organic_search',
  'direct',
  'paid_search',
  'display',
  'facebook',
  'referral',
  'total_views',
];

function isMissingRpcError(error) {
  const msg = String(error?.message ?? error ?? '');
  return /function.*does not exist|could not find the function|schema cache/i.test(msg);
}

function titleScore(title) {
  const t = String(title || '').trim();
  if (!t) return 9;
  if (/^(new|used)\s+[0-9]{4}\b/i.test(t)) return 0;
  if (/^(new|used)\b/i.test(t)) return 1;
  return 2;
}

function isBetterTitle(candidate, current) {
  const a = titleScore(candidate.page_title);
  const b = titleScore(current.page_title);
  if (a !== b) return a < b;
  const aLen = String(candidate.page_title || '').length;
  const bLen = String(current.page_title || '').length;
  if (aLen !== bLen) return aLen > bLen;
  return String(candidate.title_date || '') > String(current.title_date || '');
}

/** Merge per-window rows by page_path, rank by total views, apply Top N. */
export function mergeVdpPageTitleChunks(rawRows, limit) {
  const byPath = new Map();
  for (const row of rawRows || []) {
    const key = row?.page_path;
    if (!key) continue;
    const prev = byPath.get(key);
    if (!prev) {
      const next = { ...row };
      for (const k of SUM_KEYS) next[k] = Number(row[k]) || 0;
      byPath.set(key, next);
      continue;
    }
    for (const k of SUM_KEYS) prev[k] += Number(row[k]) || 0;
    if (!prev.page_url && row.page_url) prev.page_url = row.page_url;
    if (row.page_title && isBetterTitle(row, prev)) {
      prev.page_title = row.page_title;
      prev.title_date = row.title_date;
    }
  }

  const ranked = [...byPath.values()]
    .filter((r) => r.total_views > 0)
    .sort(
      (a, b) =>
        b.total_views - a.total_views ||
        String(a.page_title || '').localeCompare(String(b.page_title || ''))
    )
    .map((r, i) => ({ ...r, rank: i + 1 }));

  return limit ? ranked.slice(0, limit) : ranked;
}

/**
 * VDP page title × channel matrix, fetched in small date windows so a heavy
 * dealer/month never hits statement_timeout. Emits partial Top N as windows land.
 */
export async function fetchVdpPageTitleChunked({
  clientId,
  from,
  to,
  limit = 10,
  vdpFilters,
  tab = 'vdp',
  ga4PropertyId,
  onCancelCheck,
  onProgress,
}) {
  if (!clientId || !from || !to) return [];
  const supabase = createClient();
  if (!supabase) throw new Error('Supabase is not configured.');
  if (onCancelCheck?.()) return null;

  const extraParams = withPropertyRpcParams(vdpRpcExtraParams(vdpFilters, tab), ga4PropertyId);

  try {
    const raw = await rpcByDateChunksProgressive(supabase, CHUNK_RPC, {
      clientId,
      from,
      to,
      extraParams,
      chunkDays: CHUNK_DAYS,
      concurrency: CHUNK_CONCURRENCY,
      onCancelCheck,
      onBatch: (batch, meta) => {
        if (onCancelCheck?.()) return;
        onProgress?.(mergeVdpPageTitleChunks(batch, limit), meta);
      },
    });
    if (raw == null || onCancelCheck?.()) return null;
    return mergeVdpPageTitleChunks(raw, limit);
  } catch (err) {
    if (onCancelCheck?.()) return null;
    if (!isMissingRpcError(err)) throw err;
  }

  const { data, error } = await supabase.rpc(LEGACY_RPC, {
    p_client_id: String(clientId).trim(),
    p_from: String(from).slice(0, 10),
    p_to: String(to).slice(0, 10),
    p_limit: limit,
    ...extraParams,
  });
  if (error) {
    if (isPropertyScoped(ga4PropertyId) && isMissingRpcError(error)) return [];
    throw new Error(error.message || 'Failed to fetch VDP page title channels.');
  }
  return data || [];
}
