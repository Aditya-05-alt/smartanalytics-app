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

/** Per-dealer totals from a matrix, respecting optional channel filter. */
export function dealerTotalsFromMatrix(matrix, channelFilter = []) {
  const expanded = expandChannelsForRpc(channelFilter);
  const allowed = expanded?.length
    ? new Set(expanded.map((c) => normalizeChannelKey(c)))
    : null;

  return (matrix?.rows || []).map((row) => {
    let total = 0;
    for (const slice of row.slices || []) {
      const name = String(slice.name || '').trim();
      if (!name) continue;
      if (allowed && !allowed.has(normalizeChannelKey(name))) continue;
      total += Number(slice.value) || 0;
    }
    return {
      dealerId: String(row.dealer?.id || row.dealer?.ga4CustomerId || ''),
      name: row.dealer?.name || 'Dealer',
      total,
      error: row.error || null,
    };
  });
}

function emptySideResult() {
  return { channels: [], dealerTotals: [] };
}

function sideResultFromChannels(channelRows, dealers) {
  const channels = channelRows || [];
  const total = channels.reduce((s, r) => s + (Number(r.views) || 0), 0);
  const list = (dealers || []).filter((d) => d?.ga4CustomerId);
  // Single-dealer (or fallback): one total that matches the channel sum.
  if (list.length === 1) {
    const d = list[0];
    return {
      channels,
      dealerTotals: [
        {
          dealerId: String(d.id || d.ga4CustomerId),
          name: d.name || 'Dealer',
          total,
          error: null,
        },
      ],
    };
  }
  return {
    channels,
    dealerTotals: list.map((d) => ({
      dealerId: String(d.id || d.ga4CustomerId),
      name: d.name || 'Dealer',
      total: 0,
      error: null,
    })),
  };
}

function sideResultFromMatrix(matrix, channelFilter, dealers) {
  const channels = filterChannelRowsBySelection(
    aggregateMatrixToChannelRows(matrix),
    channelFilter
  );
  let dealerTotals = dealerTotalsFromMatrix(matrix, channelFilter);
  // Ensure every requested dealer appears even if matrix missed a row.
  if (dealerTotals.length === 0 && dealers?.length) {
    return sideResultFromChannels(channels, dealers);
  }
  return { channels, dealerTotals };
}

/**
 * Compare-only fast path: ga4_compare_vdp_channel_daily via dedicated RPC.
 * Does not call All Dealers matrix.
 */
async function fetchCompareVdpMatrixViaApi({ from, to, dealers, onCancelCheck }) {
  if (onCancelCheck?.()) return null;
  if (typeof window === 'undefined') return null;

  const qs = new URLSearchParams({ from, to });
  for (const d of dealers || []) {
    const id = String(d?.ga4CustomerId || '').trim();
    if (id) qs.append('clientId', id);
  }

  const res = await fetch(`/api/dashboard/compare-vdp-channels?${qs}`, {
    credentials: 'same-origin',
  });
  const json = await res.json().catch(() => ({}));
  if (onCancelCheck?.()) return null;
  if (!res.ok) {
    throw new Error(json.error || `Compare VDP channels failed (${res.status})`);
  }
  return matrixFromRpcRows(json.data || [], dealers);
}

/**
 * Fetch channel views for one or many dealers (sums when multi / category / all).
 * @returns {{ channels: object[], dealerTotals: { dealerId, name, total, error }[] }}
 */
export async function fetchCompareSideChannels({
  dealers,
  from,
  to,
  pageTypeFilter = 'VDP',
  channelFilter = [],
  onCancelCheck,
  onProgress,
}) {
  const list = (dealers || []).filter((d) => d?.ga4CustomerId);
  if (!list.length || !from || !to) {
    onProgress?.({ completed: 1, total: 1 });
    return emptySideResult();
  }

  const channels = selectedChannels(channelFilter);
  const vdpFilters = channels.length ? { channel: channels } : {};
  const tab = pageTypeFilter === 'VDP' ? 'vdp' : 'all';
  const report = (completed, total) => {
    onProgress?.({
      completed: Math.max(0, Number(completed) || 0),
      total: Math.max(1, Number(total) || 1),
    });
  };

  if (list.length === 1) {
    const d = list[0];
    report(0, 1);
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
      onProgress: (_partial, meta) => {
        if (onCancelCheck?.()) return;
        report(meta?.completed ?? 0, meta?.total ?? 1);
      },
    });
    if (onCancelCheck?.()) return emptySideResult();
    const listRows = Array.isArray(rows) ? rows : [];
    report(1, 1);
    return sideResultFromChannels(
      filterChannelRowsBySelection(listRows, channels),
      list
    );
  }

  // Multi / All Dealers / category — Compare-only fast path for VDP
  if (String(pageTypeFilter || '').toUpperCase() === 'VDP') {
    try {
      report(0, 1);
      const matrix = await fetchCompareVdpMatrixViaApi({
        from,
        to,
        dealers: list,
        onCancelCheck,
      });
      if (onCancelCheck?.()) return emptySideResult();
      if (matrix) {
        report(1, 1);
        return sideResultFromMatrix(matrix, channels, list);
      }
    } catch (err) {
      // Fall through to legacy All Dealers matrix only if Compare table misses coverage
      console.warn('[compare] fast VDP path failed, falling back:', err?.message);
    }
  }

  report(0, 1);
  const matrix = await fetchAllDealersChannelMatrix({
    dealers: list,
    from,
    to,
    pageTypeFilter,
    onCancelCheck,
    onProgress: (p) => {
      if (onCancelCheck?.()) return;
      report(p?.completed ?? 0, p?.total ?? 1);
    },
  });
  if (onCancelCheck?.()) return emptySideResult();
  report(1, 1);
  return sideResultFromMatrix(matrix, channels, list);
}
