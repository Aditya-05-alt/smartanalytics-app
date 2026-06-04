import { createClient } from '@/lib/supabase/client';
import { rpcByDateChunks } from '@/lib/api/chunkedRpc';
import { mergeChannelBreakdownRows } from '@/lib/ga4/channelBreakdownMerge';
import {
  getChannelBreakdownCache,
  setChannelBreakdownCache,
} from '@/lib/data/channelBreakdownCache';

const CLIENT_CHUNK_DAYS = 14;
const CLIENT_CHUNK_CONCURRENCY = 3;

async function fetchViaApi({ clientId, from, to, pageTypeFilter, onCancelCheck }) {
  if (typeof window === 'undefined') return null;
  if (onCancelCheck?.()) return null;

  const qs = new URLSearchParams({
    clientId,
    from,
    to,
    pageType: pageTypeFilter,
  });
  const res = await fetch(`/api/dashboard/channel-breakdown?${qs}`, {
    credentials: 'same-origin',
  });
  const json = await res.json().catch(() => ({}));

  if (onCancelCheck?.()) return null;
  if (!res.ok) {
    if (res.status === 503) return null;
    throw new Error(json.error || `Channel breakdown failed (${res.status})`);
  }

  return json.rows || [];
}

async function fetchViaClient({ clientId, from, to, pageTypeFilter, onCancelCheck }) {
  const supabase = createClient();
  if (!supabase) throw new Error('Supabase is not configured.');

  const raw = await rpcByDateChunks(supabase, 'get_ga4_channel_breakdown', {
    clientId,
    from,
    to,
    extraParams: { p_page_type: pageTypeFilter },
    chunkDays: CLIENT_CHUNK_DAYS,
    concurrency: CLIENT_CHUNK_CONCURRENCY,
    onCancelCheck,
  });

  if (onCancelCheck?.()) return null;
  return mergeChannelBreakdownRows(raw);
}

/**
 * Channel breakdown — server API (service role) with client fallback + session cache.
 */
export async function fetchChannelBreakdownBundle({
  clientId,
  from,
  to,
  pageTypeFilter = 'ALL',
  onCancelCheck,
  skipCache = false,
}) {
  if (!clientId || !from || !to) return [];

  if (!skipCache) {
    const cached = getChannelBreakdownCache(clientId, from, to, pageTypeFilter);
    if (cached) return cached;
  }

  let rows;
  try {
    rows = await fetchViaApi({ clientId, from, to, pageTypeFilter, onCancelCheck });
    if (rows == null) {
      rows = await fetchViaClient({
        clientId,
        from,
        to,
        pageTypeFilter,
        onCancelCheck,
      });
    }
  } catch (err) {
    if (onCancelCheck?.()) return null;
    const fallback = await fetchViaClient({
      clientId,
      from,
      to,
      pageTypeFilter,
      onCancelCheck,
    });
    if (fallback != null) {
      rows = fallback;
    } else {
      throw err;
    }
  }

  if (onCancelCheck?.()) return null;
  const result = rows || [];
  setChannelBreakdownCache(clientId, from, to, pageTypeFilter, result);
  return result;
}
