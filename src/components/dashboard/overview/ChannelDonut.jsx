'use client';

import { useEffect, useMemo, useState } from 'react';
import { fetchChannelBreakdown } from '@/lib/api/dashboardApi';
import { useOverview } from './OverviewDataContext';
import BreakdownDonut from './BreakdownDonut';

const BUCKET_COLORS = {
  Organic: '#34d399',
  'Paid Search': '#60a5fa',
  Direct: '#a3e635',
  'Paid Social': '#fb923c',
  Other: '#9ca3af',
};

const BUCKET_ORDER = ['Organic', 'Paid Search', 'Direct', 'Paid Social', 'Other'];

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

function rowsToDonutData(rows) {
  const byBucket = new Map(rows.map((r) => [r.channel_bucket, r]));
  return BUCKET_ORDER.map((bucket) => {
    const row = byBucket.get(bucket) || { channel_bucket: bucket, views: 0, pct: 0 };
    return {
      name: bucket,
      color: BUCKET_COLORS[bucket],
      value: Number(row.views) || 0,
      pct: Number(row.pct) || 0,
    };
  });
}

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
    totals,
    clientKey,
    from: ctxFrom,
    to: ctxTo,
    loading: overviewLoading,
  } = useOverview();

  const tabId = resolveTabId(pageTypeProp, tab);
  const pageTypeFilter = TAB_TO_FILTER[tabId] || 'ALL';
  const centerLabel = CENTER_LABEL[tabId] || 'ALL VIEWS';

  const clientId = clientIdProp ?? clientKey;
  const from = fromProp ?? ctxFrom;
  const to = toProp ?? ctxTo;

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!clientId || !from || !to) {
      setRows([]);
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchChannelBreakdown({
      clientId,
      from,
      to,
      pageTypeFilter,
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
  }, [clientId, from, to, pageTypeFilter]);

  const data = useMemo(() => rowsToDonutData(rows), [rows]);

  const sliceTotal = useMemo(
    () => data.reduce((sum, row) => sum + (Number(row.value) || 0), 0),
    [data]
  );

  // VDP channel RPC may return empty buckets; total still shows mapped VDP views.
  const displayTotal =
    tabId === 'vdp' ? Number(totals?.vdp) || 0 : sliceTotal;

  const centerDisplay =
    displayTotal > 0
      ? new Intl.NumberFormat('en', {
          notation: 'compact',
          maximumFractionDigits: 1,
        }).format(displayTotal)
      : '0';

  return (
    <BreakdownDonut
      title="Channel Breakdown"
      data={data}
      centerLabel={centerLabel}
      centerValue={centerDisplay}
      totalViews={displayTotal}
      totalLabel="Total"
      loading={loading || (!clientId && overviewLoading)}
      error={error}
    />
  );
}
