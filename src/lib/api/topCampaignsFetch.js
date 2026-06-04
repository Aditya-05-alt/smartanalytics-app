import { createClient } from '@/lib/supabase/client';
import { rpcByDateChunks } from '@/lib/api/chunkedRpc';
import { mergeTopCampaignRows } from '@/lib/ga4/topCampaignsMerge';
import {
  getTopCampaignsCache,
  setTopCampaignsCache,
} from '@/lib/data/topCampaignsCache';

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

async function fetchViaClient({ clientId, from, to, pageTypeFilter, onCancelCheck }) {
  const supabase = createClient();
  if (!supabase) throw new Error('Supabase is not configured.');

  const raw = await rpcByDateChunks(supabase, 'get_top_campaigns', {
    clientId,
    from,
    to,
    extraParams: { p_page_type: pageTypeFilter, p_limit: null },
    chunkDays: CLIENT_CHUNK_DAYS,
    concurrency: CLIENT_CHUNK_CONCURRENCY,
    onCancelCheck,
  });

  if (onCancelCheck?.()) return null;
  return mergeTopCampaignRows(raw);
}

/** All campaigns for range — server API + cache (no per-chunk limit). */
export async function fetchTopCampaignsBundle({
  clientId,
  from,
  to,
  pageTypeFilter = 'ALL',
  onCancelCheck,
  skipCache = false,
}) {
  if (!clientId || !from || !to) return [];

  if (!skipCache) {
    const cached = getTopCampaignsCache(clientId, from, to, pageTypeFilter);
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
    rows = await fetchViaClient({
      clientId,
      from,
      to,
      pageTypeFilter,
      onCancelCheck,
    });
    if (rows == null) throw err;
  }

  if (onCancelCheck?.()) return null;
  const result = rows || [];
  setTopCampaignsCache(clientId, from, to, pageTypeFilter, result);
  return result;
}
