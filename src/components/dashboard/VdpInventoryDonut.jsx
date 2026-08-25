'use client';

import { useMemo, useState } from 'react';
import ChartTopNSelect from '@/components/dashboard/ChartTopNSelect';
import CompareBreakdownSection from '@/components/dashboard/CompareBreakdownSection';
import BreakdownDonut from '@/components/dashboard/overview/BreakdownDonut';
import { useOverview } from '@/components/dashboard/overview/OverviewDataContext';
import { useBreakdownFetch } from '@/hooks/useBreakdownFetch';
import { formatViewsK } from '@/lib/format/viewsK';
import { buildDonutCompareDeltas } from '@/lib/overview/comparePeriod';

function InventoryDonutDisplay({
  rows,
  loading,
  error,
  periodLabel,
  centerLabel = 'VDP VIEWS',
  chartTopN,
  headerExtra,
  emptyMessage,
  toDonutRow,
  baselineDonutData,
  keepPreviousOnReload = true,
}) {
  const allData = useMemo(
    () => rows.map((row, index) => toDonutRow(row, index)),
    [rows, toDonutRow]
  );
  const chartData = useMemo(() => {
    if (chartTopN == null) return allData;
    return allData.slice(0, chartTopN);
  }, [allData, chartTopN]);

  const listData = useMemo(() => {
    if (!baselineDonutData) return allData;
    const { items } = buildDonutCompareDeltas(allData, baselineDonutData);
    return items;
  }, [allData, baselineDonutData]);

  const { totalDelta } = useMemo(() => {
    if (!baselineDonutData) return { totalDelta: null };
    return buildDonutCompareDeltas(allData, baselineDonutData);
  }, [allData, baselineDonutData]);

  const leafTotal = useMemo(
    () => allData.reduce((sum, row) => sum + (Number(row.value) || 0), 0),
    [allData]
  );

  const chartTotal = useMemo(
    () => chartData.reduce((sum, row) => sum + (Number(row.value) || 0), 0),
    [chartData]
  );

  const showSkeleton = loading && (keepPreviousOnReload ? rows.length === 0 : true);

  return (
    <BreakdownDonut
      title={periodLabel}
      data={listData}
      chartData={chartData}
      centerLabel={centerLabel}
      centerValue={formatViewsK(chartTotal)}
      totalViews={leafTotal}
      totalLabel="Total"
      totalDelta={totalDelta}
      headerExtra={headerExtra}
      loading={showSkeleton}
      error={error}
      emptyMessage={!loading && !error && rows.length === 0 ? emptyMessage : null}
      skeletonRows={8}
      listScrollable
    />
  );
}

function InventoryDonutPane({
  periodLabel,
  clientId,
  from,
  to,
  topN,
  vdpFilters,
  tab,
  ga4PropertyId,
  enabled,
  fetchFn,
  normalize,
  errorMessage,
  toDonutRow,
  emptyMessage,
  baselineDonutData,
  ignoreVdpFilters = false,
  centerLabel = 'VDP VIEWS',
  keepPreviousOnReload = true,
}) {
  const { rows, loading, error } = useBreakdownFetch({
    enabled,
    clientId,
    from,
    to,
    topN,
    vdpFilters,
    tab,
    ga4PropertyId,
    fetchFn,
    normalize,
    errorMessage,
    ignoreVdpFilters,
    keepPreviousOnReload,
  });

  return (
    <InventoryDonutDisplay
      rows={rows}
      loading={loading}
      error={error}
      periodLabel={periodLabel}
      chartTopN={topN}
      toDonutRow={toDonutRow}
      emptyMessage={emptyMessage}
      baselineDonutData={baselineDonutData}
      centerLabel={centerLabel}
      keepPreviousOnReload={keepPreviousOnReload}
    />
  );
}

export default function VdpInventoryDonut({
  title,
  fetchFn,
  normalize,
  errorMessage,
  toDonutRow,
  emptyMessage = 'No data for this period.',
  centerLabel = 'VDP VIEWS',
  limit = null,
  ignoreVdpFilters = false,
  keepPreviousOnReload = true,
  clientId: clientIdProp,
  from: fromProp,
  to: toProp,
}) {
  const {
    tab,
    vdpFilters,
    clientKey,
    ga4PropertyId,
    from: ctxFrom,
    to: ctxTo,
    compareEnabled,
    compareFrom,
    compareTo,
    currentPeriodLabel,
    comparePeriodLabel,
  } = useOverview();

  const clientId = clientIdProp ?? clientKey;
  const from = fromProp ?? ctxFrom;
  const to = toProp ?? ctxTo;

  const [topN, setTopN] = useState(limit === 5 ? 5 : limit === 10 ? 10 : null);
  const enabled = tab === 'vdp';
  const showCompare = enabled && compareEnabled && compareFrom && compareTo;

  const compareFetch = useBreakdownFetch({
    enabled: enabled && showCompare,
    clientId,
    from: compareFrom,
    to: compareTo,
    topN,
    vdpFilters,
    tab,
    ga4PropertyId,
    fetchFn,
    normalize,
    errorMessage,
    ignoreVdpFilters,
    keepPreviousOnReload,
  });

  const singleFetch = useBreakdownFetch({
    enabled: enabled && !showCompare,
    clientId,
    from,
    to,
    topN,
    vdpFilters,
    tab,
    ga4PropertyId,
    fetchFn,
    normalize,
    errorMessage,
    ignoreVdpFilters,
    keepPreviousOnReload,
  });

  const compareAllData = useMemo(
    () => (compareFetch.rows || []).map((row, index) => toDonutRow(row, index)),
    [compareFetch.rows, toDonutRow]
  );

  const topNControl = (
    <div className="make-breakdown-head-controls">
      <ChartTopNSelect
        value={topN}
        onChange={setTopN}
        ariaLabel={`${title} chart limit`}
      />
    </div>
  );

  if (!enabled) return null;

  if (showCompare) {
    return (
      <CompareBreakdownSection title={title} headerExtra={topNControl}>
        <InventoryDonutDisplay
          rows={compareFetch.rows}
          loading={compareFetch.loading}
          error={compareFetch.error}
          periodLabel={comparePeriodLabel}
          centerLabel={centerLabel}
          chartTopN={topN}
          toDonutRow={toDonutRow}
          emptyMessage={emptyMessage}
          keepPreviousOnReload={keepPreviousOnReload}
        />
        <InventoryDonutPane
          periodLabel={currentPeriodLabel}
          clientId={clientId}
          from={from}
          to={to}
          topN={topN}
          vdpFilters={vdpFilters}
          tab={tab}
          ga4PropertyId={ga4PropertyId}
          enabled={enabled}
          fetchFn={fetchFn}
          normalize={normalize}
          errorMessage={errorMessage}
          toDonutRow={toDonutRow}
          emptyMessage={emptyMessage}
          baselineDonutData={compareAllData}
          ignoreVdpFilters={ignoreVdpFilters}
          centerLabel={centerLabel}
          keepPreviousOnReload={keepPreviousOnReload}
        />
      </CompareBreakdownSection>
    );
  }

  return (
    <InventoryDonutDisplay
      rows={singleFetch.rows}
      loading={singleFetch.loading}
      error={singleFetch.error}
      periodLabel={title}
      centerLabel={centerLabel}
      chartTopN={topN}
      toDonutRow={toDonutRow}
      emptyMessage={emptyMessage}
      headerExtra={topNControl}
      keepPreviousOnReload={keepPreviousOnReload}
    />
  );
}
