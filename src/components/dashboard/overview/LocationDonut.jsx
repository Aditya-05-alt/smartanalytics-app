'use client';

import { useEffect, useMemo, useState } from 'react';
import { fetchLocationBreakdown } from '@/lib/api/dashboardApi';
import CompareBreakdownSection from '../CompareBreakdownSection';
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

function useLocationRows({ clientId, from, to, enabled, vdpFilters, tab }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!enabled || !clientId || !from || !to) {
      setRows([]);
      setError(null);
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
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
        if (cancelled) return;
        if (data === undefined) return;
        setRows(data || []);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.message || 'Failed to load location breakdown.');
        setRows([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [clientId, from, to, enabled, vdpFilters, tab]);

  return { rows, loading, error };
}

function LocationDonutDisplay({
  rows,
  loading,
  error,
  clientId,
  periodLabel,
  overviewLoading,
  from,
  to,
}) {
  const data = useMemo(() => rpcRowsToDisplay(rows), [rows]);
  const emptyAfterLoad = !loading && !error && rows.length === 0;

  return (
    <BreakdownDonut
      title={periodLabel}
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
      skeletonRows={8}
      listScrollable
      pctDecimals={2}
    />
  );
}

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
    compareEnabled,
    compareFrom,
    compareTo,
    currentPeriodLabel,
    comparePeriodLabel,
  } = useOverview();

  const pageType = pageTypeProp || TAB_TO_PAGE_TYPE[tab] || 'All';
  const enabled = VDP_ENABLED_TABS.has(pageType);

  const clientId = clientIdProp ?? clientKey;
  const from = fromProp ?? ctxFrom;
  const to = toProp ?? ctxTo;

  const showCompare = enabled && compareEnabled && compareFrom && compareTo;

  const compareFetch = useLocationRows({
    clientId,
    from: compareFrom,
    to: compareTo,
    enabled: enabled && showCompare,
    vdpFilters,
    tab,
  });

  const currentFetch = useLocationRows({
    clientId,
    from,
    to,
    enabled: enabled && showCompare,
    vdpFilters,
    tab,
  });

  const singleFetch = useLocationRows({
    clientId,
    from,
    to,
    enabled: enabled && !showCompare,
    vdpFilters,
    tab,
  });

  if (!enabled) {
    return (
      <BreakdownDonut
        title="Location Breakdown"
        centerLabel="LOCAL VISITORS"
        disabled
        disabledMessage="VDP data only"
        disabledSubtext="Available on All and VDP tabs only. Location data is sourced from VDP-matched inventory."
      />
    );
  }

  if (showCompare) {
    return (
      <CompareBreakdownSection title="Location Breakdown">
        <LocationDonutDisplay
          rows={compareFetch.rows}
          loading={compareFetch.loading}
          error={compareFetch.error}
          clientId={clientId}
          periodLabel={comparePeriodLabel}
          overviewLoading={overviewLoading}
          from={compareFrom}
          to={compareTo}
        />
        <LocationDonutDisplay
          rows={currentFetch.rows}
          loading={currentFetch.loading}
          error={currentFetch.error}
          clientId={clientId}
          periodLabel={currentPeriodLabel}
          overviewLoading={overviewLoading}
          from={from}
          to={to}
        />
      </CompareBreakdownSection>
    );
  }

  return (
    <LocationDonutDisplay
      rows={singleFetch.rows}
      loading={singleFetch.loading}
      error={singleFetch.error}
      clientId={clientId}
      periodLabel="Location Breakdown"
      overviewLoading={overviewLoading}
      from={from}
      to={to}
    />
  );
}
