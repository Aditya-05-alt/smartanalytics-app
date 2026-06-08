'use client';

import { useEffect, useMemo, useState } from 'react';
import { fetchChannelBreakdownBundle } from '@/lib/api/channelBreakdownFetch';
import {
  getChannelBreakdownCache,
  hasChannelBreakdownCache,
} from '@/lib/data/channelBreakdownCache';
import { vdpFilterCacheSuffix } from '@/lib/vdp/vdpFilterParams';
import ChartTopNSelect from '@/components/dashboard/ChartTopNSelect';
import { channelRowsToDonutData } from '@/lib/ga4/channelDisplay';
import { useOverview } from './OverviewDataContext';
import BreakdownDonut from './BreakdownDonut';

const ALL_PAGE_TYPE_FILTERS = ['ALL', 'VDP', 'SRP', 'Home', 'Other'];

/** Top tab id (OverviewDataContext) → RPC p_page_type */
const TAB_TO_FILTER = {
  all: 'ALL',
  vdp: 'VDP',
  srp: 'SRP',
  home: 'Home',
  other: 'Other',
};

const CENTER_LABEL = {
  all: 'ALL VIEWS',
  vdp: 'VDP VIEWS',
  srp: 'SRP VIEWS',
  home: 'HOMEPAGE VIEWS',
  other: 'OTHER VIEWS',
};

/** Optional prop labels → tab id */
const PAGE_TYPE_TO_TAB = {
  All: 'all',
  VDP: 'vdp',
  SRP: 'srp',
  Homepage: 'home',
  Other: 'other',
};

function resolveTabId(pageTypeProp, tabFromContext) {
  if (pageTypeProp && PAGE_TYPE_TO_TAB[pageTypeProp]) {
    return PAGE_TYPE_TO_TAB[pageTypeProp];
  }
  return tabFromContext || 'all';
}

/**
 * Channel-breakdown donut — views by marketing channel from
 * `get_ga4_channel_breakdown` (page-grain views only).
 * Page type filter follows the top-level dashboard tabs via OverviewDataContext.
 */
export default function ChannelDonut({
  clientId: clientIdProp,
  from: fromProp,
  to: toProp,
  pageType: pageTypeProp,
}) {
  const {
    tab,
    vdpFilters,
    clientKey,
    from: ctxFrom,
    to: ctxTo,
    loading: overviewLoading,
  } = useOverview();

  const tabId = resolveTabId(pageTypeProp, tab);
  const pageTypeFilter = TAB_TO_FILTER[tabId] || 'ALL';
  const centerLabel = CENTER_LABEL[tabId] || 'ALL VIEWS';
  const filterCacheSuffix = vdpFilterCacheSuffix(vdpFilters, tab);

  const clientId = clientIdProp ?? clientKey;
  const from = fromProp ?? ctxFrom;
  const to = toProp ?? ctxTo;

  const [chartTopN, setChartTopN] = useState(null);
  const [rows, setRows] = useState(() =>
    clientId && from && to
      ? getChannelBreakdownCache(
          clientId,
          from,
          to,
          pageTypeFilter,
          filterCacheSuffix
        ) || []
      : []
  );
  const [loading, setLoading] = useState(
    () =>
      Boolean(
        clientId &&
          from &&
          to &&
          !hasChannelBreakdownCache(
            clientId,
            from,
            to,
            pageTypeFilter,
            filterCacheSuffix
          )
      )
  );
  const [error, setError] = useState(null);

  // Prefetch all tab filters in the background so tab switches hit cache.
  useEffect(() => {
    if (!clientId || !from || !to) return undefined;

    let cancelled = false;

    const pending = ALL_PAGE_TYPE_FILTERS.filter(
      (filter) => !hasChannelBreakdownCache(clientId, from, to, filter)
    );

    const PREFETCH_CONCURRENCY = 2;
    let next = 0;

    async function worker() {
      while (next < pending.length) {
        if (cancelled) return;
        const filter = pending[next];
        next += 1;
        try {
          await fetchChannelBreakdownBundle({
            clientId,
            from,
            to,
            pageTypeFilter: filter,
            vdpFilters,
            tab,
            onCancelCheck: () => cancelled,
          });
        } catch {
          /* prefetch failures are non-fatal */
        }
      }
    }

    Promise.all(
      Array.from({ length: Math.min(PREFETCH_CONCURRENCY, pending.length) }, () =>
        worker()
      )
    );

    return () => {
      cancelled = true;
    };
  }, [clientId, from, to, vdpFilters, tab]);

  // Active tab: cache-first, then fetch if needed.
  useEffect(() => {
    if (!clientId || !from || !to) {
      setRows([]);
      setLoading(false);
      return undefined;
    }

    const cached = getChannelBreakdownCache(
      clientId,
      from,
      to,
      pageTypeFilter,
      filterCacheSuffix
    );
    if (cached) {
      setRows(cached);
      setLoading(false);
      setError(null);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchChannelBreakdownBundle({
      clientId,
      from,
      to,
      pageTypeFilter,
      vdpFilters,
      tab,
      onCancelCheck: () => cancelled,
    })
      .then((data) => {
        if (!cancelled) setRows(data || []);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e?.message || 'Failed to load channel breakdown.');
          setRows([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [clientId, from, to, pageTypeFilter, vdpFilters, tab, filterCacheSuffix]);

  const allData = useMemo(() => channelRowsToDonutData(rows), [rows]);

  const displayData = useMemo(() => {
    if (chartTopN == null) return allData;
    return allData.slice(0, chartTopN);
  }, [allData, chartTopN]);

  const displayedTotal = useMemo(
    () => displayData.reduce((sum, row) => sum + (Number(row.value) || 0), 0),
    [displayData]
  );

  const centerDisplay =
    displayedTotal > 0
      ? new Intl.NumberFormat('en', {
          notation: 'compact',
          maximumFractionDigits: 1,
        }).format(displayedTotal)
      : '0';

  return (
    <BreakdownDonut
      title="Channel Breakdown"
      data={displayData}
      headerExtra={
        <div className="make-breakdown-head-controls">
          <ChartTopNSelect
            value={chartTopN}
            onChange={setChartTopN}
            ariaLabel="Channel chart limit"
          />
        </div>
      }
      centerLabel={centerLabel}
      centerValue={centerDisplay}
      totalViews={displayedTotal}
      totalLabel="Total"
      loading={loading || (!clientId && overviewLoading)}
      error={error}
      skeletonRows={8}
      listScrollable
    />
  );
}
