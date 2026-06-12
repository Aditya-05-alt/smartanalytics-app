'use client';

import { useEffect, useMemo, useState } from 'react';
import { fetchLocationBreakdown } from '@/lib/api/dashboardApi';
import { useOverview } from './OverviewDataContext';
import BreakdownDonut from './BreakdownDonut';

const LOCATION_COLORS = ['#34d399', '#60a5fa', '#a3e635', '#fb923c', '#a78bfa', '#9ca3af'];

const VDP_ENABLED_TABS = new Set(['All', 'VDP']);

const TAB_TO_PAGE_TYPE = {
  all: 'All',
  vdp: 'VDP',
  srp: 'SRP',
  home: 'Homepage',
  other: 'Other',
};

function truncateLabel(label, max = 22) {
  if (!label || label.length <= max) return label;
  return `${label.slice(0, max - 1)}…`;
}

function colorForRank(rank) {
  const r = Number(rank) || 999;
  if (r >= 999) return LOCATION_COLORS[LOCATION_COLORS.length - 1];
  return LOCATION_COLORS[Math.min(r - 1, LOCATION_COLORS.length - 1)];
}

/** Map RPC rows to chart display — no aggregation; render server output as-is. */
function rpcRowsToDisplay(rows) {
  return rows.map((row) => {
    const fullName = String(row.location_bucket ?? '');
    return {
      name: truncateLabel(fullName),
      fullName,
      color: colorForRank(row.rank),
      value: Number(row.views) || 0,
      pct: Number(row.pct) || 0,
    };
  });
}

/**
 * Location Breakdown — get_location_breakdown RPC output.
 * Fetches only on All / VDP tabs.
 */
export default function LocationDonut({
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

  const pageType = pageTypeProp || TAB_TO_PAGE_TYPE[tab] || 'All';
  const enabled = VDP_ENABLED_TABS.has(pageType);

  const clientId = clientIdProp ?? clientKey;
  const from = fromProp ?? ctxFrom;
  const to = toProp ?? ctxTo;

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!enabled) {
      setRows([]);
      setError(null);
      setLoading(false);
      return undefined;
    }

    if (!clientId || !from || !to) {
      setRows([]);
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    let requestId = 0;
    const thisRequest = ++requestId;

    if (rows.length === 0) setLoading(true);
    setError(null);

    fetchLocationBreakdown({
      clientId,
      from,
      to,
      vdpFilters,
      tab,
      onCancelCheck: () => cancelled,
    })
      .then((data) => {
        if (cancelled || thisRequest !== requestId) return;
        if (data === undefined) return;
        setRows(data);
      })
      .catch((e) => {
        if (cancelled || thisRequest !== requestId) return;
        setError(e?.message || 'Failed to load location breakdown.');
        setRows([]);
      })
      .finally(() => {
        if (cancelled || thisRequest !== requestId) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [clientId, from, to, pageType, enabled, vdpFilters, tab]);

  const data = useMemo(() => rpcRowsToDisplay(rows), [rows]);

  const badge = { label: 'Local', bg: 'var(--od)', color: 'var(--orange)' };

  if (!enabled) {
    return (
      <BreakdownDonut
        title="Location Breakdown"
        badge={badge}
        centerLabel="LOCAL VISITORS"
        disabled
        disabledMessage="VDP data only"
        disabledSubtext="Available on All and VDP tabs only. Location data is sourced from VDP-matched inventory."
      />
    );
  }

  const emptyAfterLoad = !loading && !error && rows.length === 0;

  return (
    <BreakdownDonut
      title="Location Breakdown"
      badge={badge}
      data={data}
      centerLabel="LOCAL VISITORS"
      totalLabel="Total"
      loading={(loading && rows.length === 0) || (!clientId && overviewLoading)}
      error={error}
      emptyMessage={
        emptyAfterLoad
          ? `No location data for ${from} → ${to} (client ${clientId}).`
          : null
      }
      skeletonRows={6}
      pctDecimals={2}
    />
  );
}
