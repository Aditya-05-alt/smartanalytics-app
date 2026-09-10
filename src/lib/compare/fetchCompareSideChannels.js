import {
  fetchAllDealersChannelMatrix,
  matrixFromRpcRows,
} from '@/lib/api/allDealerChannelMatrix';
import { fetchChannelBreakdownBundle } from '@/lib/api/channelBreakdownFetch';
import { normalizeChannelKey } from '@/lib/ga4/channelGroups';
import {
  expandChannelsForRpc,
  selectedChannels,
} from '@/lib/vdp/vdpFilterParams';

/** Sum per-dealer matrix slices into channel breakdown rows. */
export function aggregateMatrixToChannelRows(matrix) {
  const map = new Map();
  for (const row of matrix?.rows || []) {
    for (const slice of row.slices || []) {
      const key = String(slice.name || '').trim();
      if (!key) continue;
      map.set(key, (map.get(key) || 0) + (Number(slice.value) || 0));
    }
  }
  return [...map.entries()].map(([channel_bucket, views]) => ({
    channel_bucket,
    views,
  }));
}

/** Keep only channels matching the UI channel filter (empty = all). */
export function filterChannelRowsBySelection(rows, channelFilter) {
  const expanded = expandChannelsForRpc(channelFilter);
  if (!expanded?.length) return rows || [];
  const allowed = new Set(expanded.map((c) => normalizeChannelKey(c)));
  return (rows || []).filter((r) =>
    allowed.has(normalizeChannelKey(r.channel_bucket ?? r.ch))
  );
}

/**
 * Compare-only fast path: ga4_compare_vdp_channel_daily via dedicated RPC.
 * Does not call All Dealers matrix.
 */
async function fetchCompareVdpMatrixViaApi({ from, to, dealers, onCancelCheck }) {
  if (onCancelCheck?.()) return [];
  if (typeof window === 'undefined') return [];

  const qs = new URLSearchParams({ from, to });
  for (const d of dealers || []) {
    const id = String(d?.ga4CustomerId || '').trim();
    if (id) qs.append('clientId', id);
  }

  const res = await fetch(`/api/dashboard/compare-vdp-channels?${qs}`, {
    credentials: 'same-origin',
  });
  const json = await res.json().catch(() => ({}));
  if (onCancelCheck?.()) return [];
  if (!res.ok) {
    throw new Error(json.error || `Compare VDP channels failed (${res.status})`);
  }
  return matrixFromRpcRows(json.data || [], dealers);
}

/**
 * Fetch channel views for one or many dealers (sums when multi / category / all).
 * @param {string[]} [channelFilter] — UI channel filter labels (empty = all)
 */
export async function fetchCompareSideChannels({
  dealers,
  from,
  to,
  pageTypeFilter = 'VDP',
  channelFilter = [],
  onCancelCheck,
}) {
  const list = (dealers || []).filter((d) => d?.ga4CustomerId);
  if (!list.length || !from || !to) return [];

  const channels = selectedChannels(channelFilter);
  const vdpFilters = channels.length ? { channel: channels } : {};
  const tab = pageTypeFilter === 'VDP' ? 'vdp' : 'all';

  if (list.length === 1) {
    const d = list[0];
    const rows = await fetchChannelBreakdownBundle({
      clientId: d.ga4CustomerId,
      ga4PropertyId: d.ga4PropertyId,
      from,
      to,
      pageTypeFilter,
      vdpFilters,
      tab,
      labMode: false,
      preferServer: true,
      onCancelCheck,
      adaptiveChunks: true,
    });
    const listRows = Array.isArray(rows) ? rows : [];
    return filterChannelRowsBySelection(listRows, channels);
  }

  // Multi / All Dealers / category — Compare-only fast path for VDP
  if (String(pageTypeFilter || '').toUpperCase() === 'VDP') {
    try {
      const matrix = await fetchCompareVdpMatrixViaApi({
        from,
        to,
        dealers: list,
        onCancelCheck,
      });
      if (onCancelCheck?.()) return [];
      return filterChannelRowsBySelection(
        aggregateMatrixToChannelRows(matrix),
        channels
      );
    } catch (err) {
      // Fall through to legacy All Dealers matrix only if Compare table misses coverage
      console.warn('[compare] fast VDP path failed, falling back:', err?.message);
    }
  }

  const matrix = await fetchAllDealersChannelMatrix({
    dealers: list,
    from,
    to,
    pageTypeFilter,
    onCancelCheck,
  });
  if (onCancelCheck?.()) return [];
  return filterChannelRowsBySelection(
    aggregateMatrixToChannelRows(matrix),
    channels
  );
}
