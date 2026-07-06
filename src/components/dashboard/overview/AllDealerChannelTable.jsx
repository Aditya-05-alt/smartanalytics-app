'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Panel, PanelHeader, PanelBody } from '@/components/dashboard/Panel';
import Delta from '@/components/dashboard/Delta';
import { useClient } from '@/components/dashboard/ClientContext';
import { useOverview } from '@/components/dashboard/overview/OverviewDataContext';
import {
  compareEntryForDealer,
  compareLookupFromRows,
  fetchAllDealersChannelMatrix,
  sliceMapForRow,
} from '@/lib/api/allDealerChannelMatrix';
import { pctChange } from '@/lib/overview/comparePeriod';
import { useAllDealerMatrix } from './AllDealerMatrixContext';

const TAB_PAGE_TYPE = {
  vdp: 'VDP',
  all: 'ALL',
};

const TAB_LABEL = {
  vdp: 'VDP',
  all: 'All Pages',
};

function ChannelHeader({ name }) {
  return (
    <div className="adc-col-head" title={name}>
      <span className="adc-col-label">{name}</span>
    </div>
  );
}

function CompareColumnGuide({ currentLabel, compareLabel }) {
  const curTag = shortMonthLabel(currentLabel) || 'Current';
  const prevTag = shortMonthLabel(compareLabel) || 'Previous';
  return (
    <div className="adc-compare-guide" aria-hidden>
      <span title={currentLabel}>{curTag}</span>
      <span title={compareLabel}>{prevTag}</span>
      <span>MoM</span>
    </div>
  );
}

function shortMonthLabel(periodLabel) {
  if (!periodLabel) return '';
  const match = String(periodLabel).match(/^(\w{3})\w*\s+(\d{4})/);
  if (match) return `${match[1]} ${match[2]}`;
  return String(periodLabel).length > 12
    ? `${String(periodLabel).slice(0, 12)}…`
    : periodLabel;
}

function CompareValueCell({
  current,
  compare,
  showCompare,
  comparePending,
  currentLabel,
  compareLabel,
}) {
  const cur = Number(current) || 0;
  const cmp = Number(compare) || 0;

  if (!showCompare) {
    if (cur <= 0) return <span className="adc-cell-empty">—</span>;
    return (
      <div className="adc-cell">
        <span className="adc-cell-views">{cur.toLocaleString()}</span>
      </div>
    );
  }

  if (!comparePending && cur <= 0 && cmp <= 0) {
    return <span className="adc-cell-empty">—</span>;
  }

  const curTag = shortMonthLabel(currentLabel) || 'Current';
  const prevTag = shortMonthLabel(compareLabel) || 'Previous';

  return (
    <div className="adc-compare-stack">
      <div className="adc-compare-line">
        <span className="adc-compare-lbl" title={currentLabel}>
          {curTag}
        </span>
        <span className="adc-compare-num adc-compare-num--cur">
          {cur > 0 ? cur.toLocaleString() : '—'}
        </span>
      </div>
      <div className="adc-compare-line">
        <span className="adc-compare-lbl" title={compareLabel}>
          {prevTag}
        </span>
        <span className="adc-compare-num adc-compare-num--prev">
          {comparePending ? (
            <span className="adc-compare-pending">…</span>
          ) : (
            cmp.toLocaleString()
          )}
        </span>
      </div>
      <div className="adc-compare-line adc-compare-line--pct">
        <span className="adc-compare-lbl">MoM</span>
        <span className="adc-compare-pct">
          {comparePending ? (
            <span className="adc-compare-pending">…</span>
          ) : (
            <Delta value={pctChange(cur, cmp)} size={10} />
          )}
        </span>
      </div>
    </div>
  );
}

export default function AllDealerChannelTable() {
  const { dealers, loading: dealersLoading } = useClient();
  const { setSnapshot } = useAllDealerMatrix();
  const {
    tab,
    from,
    to,
    compareEnabled,
    compareFrom,
    compareTo,
    currentPeriodLabel,
    comparePeriodLabel,
  } = useOverview();
  const [matrixRows, setMatrixRows] = useState([]);
  const [compareMatrixRows, setCompareMatrixRows] = useState([]);
  const [columns, setColumns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [compareLoading, setCompareLoading] = useState(false);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(null);
  const cancelRef = useRef(false);
  const loadGenRef = useRef(0);

  const pageTypeFilter = TAB_PAGE_TYPE[tab] || 'ALL';
  const panelTitle = `${TAB_LABEL[tab] || 'Page'} views by channel — all dealers`;
  const showCompare = compareEnabled && compareFrom && compareTo;
  const comparePending = showCompare && compareLoading;

  const compareByDealer = useMemo(
    () => compareLookupFromRows(compareMatrixRows),
    [compareMatrixRows]
  );

  const loadMatrix = useCallback(async () => {
    if (!dealers?.length || !from || !to) {
      setMatrixRows([]);
      setCompareMatrixRows([]);
      setColumns([]);
      return;
    }

    const loadGen = loadGenRef.current + 1;
    loadGenRef.current = loadGen;
    cancelRef.current = false;
    setLoading(true);
    setCompareLoading(showCompare);
    setCompareMatrixRows([]);
    setError(null);
    setProgress(null);

    const isStale = () => cancelRef.current || loadGenRef.current !== loadGen;

    try {
      const current = await fetchAllDealersChannelMatrix({
        dealers,
        from,
        to,
        pageTypeFilter,
        onProgress: setProgress,
        onPartial: (partial) => {
          if (!isStale()) {
            setMatrixRows(partial.rows || []);
            setColumns(partial.columns || []);
            setError(null);
          }
        },
        onCancelCheck: () => isStale(),
      });

      if (isStale()) return;

      setMatrixRows(current.rows || []);
      setColumns(current.columns || []);

      let compare = { rows: [], columns: [], warning: null };
      if (showCompare) {
        setCompareLoading(true);
        setProgress(null);
        compare = await fetchAllDealersChannelMatrix({
          dealers,
          from: compareFrom,
          to: compareTo,
          pageTypeFilter,
          onProgress: (p) => {
            if (!isStale()) {
              setProgress({
                ...p,
                phase: 'compare',
              });
            }
          },
          onPartial: (partial) => {
            if (!isStale()) {
              setCompareMatrixRows(partial.rows || []);
            }
          },
          onCancelCheck: () => isStale(),
        });
      }

      if (isStale()) return;

      const mergedColumns = [...new Set([
        ...(current.columns || []),
        ...(compare.columns || []),
      ])];

      setCompareMatrixRows(showCompare ? compare.rows || [] : []);
      setColumns(mergedColumns.length ? mergedColumns : current.columns || []);
      setError(current.warning || compare.warning || null);
    } catch (err) {
      if (!isStale()) {
        setError(err?.message || 'Failed to load dealer channel data.');
        setCompareMatrixRows([]);
      }
    } finally {
      if (!isStale()) {
        setLoading(false);
        setCompareLoading(false);
        setProgress(null);
      }
    }
  }, [dealers, from, to, pageTypeFilter, showCompare, compareFrom, compareTo]);

  useEffect(() => {
    if (dealersLoading) return undefined;
    loadMatrix();
    return () => {
      cancelRef.current = true;
    };
  }, [dealersLoading, loadMatrix]);

  const tableBusy = loading || compareLoading;
  const exportReady = !dealersLoading && !tableBusy && matrixRows.length > 0 && columns.length > 0;

  useEffect(() => {
    setSnapshot({
      matrixRows,
      compareMatrixRows,
      columns,
      loading: dealersLoading || loading,
      compareLoading,
      ready: exportReady,
    });
  }, [
    matrixRows,
    compareMatrixRows,
    columns,
    dealersLoading,
    loading,
    compareLoading,
    exportReady,
    setSnapshot,
  ]);

  const showEmpty = !loading && !compareLoading && !error && matrixRows.length === 0;

  const progressLabel = useMemo(() => {
    if (!progress) {
      return compareLoading && !loading
        ? `Loading compare period (${comparePeriodLabel})…`
        : 'Loading channel matrix…';
    }
    const phase = progress.phase === 'compare' ? 'compare' : 'current';
    const batch = progress.total > 1
      ? ` ${progress.completed}/${progress.total} batches`
      : '';
    return phase === 'compare'
      ? `Loading compare period${batch}…`
      : `Loading current period${batch}…`;
  }, [progress, compareLoading, loading, comparePeriodLabel]);

  return (
    <div className="content all-dealer-overview-content">
      <Panel className="all-dealer-channel-panel">
        <PanelHeader
          title={panelTitle}
          badge={{
            label: showCompare
              ? `${currentPeriodLabel} · ${comparePeriodLabel} · MoM`
              : 'Channel combinations',
            bg: 'var(--s3)',
            color: 'var(--t2)',
          }}
        />
        <PanelBody className="all-dealer-channel-body">
          {tableBusy && (
            <div className="adc-loading-banner" role="status">
              <span className="data-updating-dot" aria-hidden />
              {progressLabel}
            </div>
          )}
          {error && (
            <div className="donut-err" role="alert">
              {error}
            </div>
          )}
          {showEmpty && !dealersLoading && (
            <div className="local-empty-state">
              <p className="local-empty-title">No dealer channel data</p>
              <p className="local-empty-sub">
                Adjust the date range or confirm dealers have GA4 IDs configured.
              </p>
            </div>
          )}
          {(tableBusy || matrixRows.length > 0) && (
            <div className="adc-table-wrap">
              <table
                className={`tbl adc-table${showCompare ? ' adc-table--compare' : ''}`}
              >
                <thead>
                  <tr>
                    <th className="adc-th-dealer" rowSpan={showCompare ? 2 : 1}>
                      Dealers
                    </th>
                    <th className="adc-th-total">Total Views</th>
                    {columns.map((name) => (
                      <th key={name} className="adc-th-channel">
                        <ChannelHeader name={name} />
                      </th>
                    ))}
                  </tr>
                  {showCompare && (
                    <tr className="adc-compare-head-row">
                      <th className="adc-th-total adc-th-compare-guide">
                        <CompareColumnGuide
                          currentLabel={currentPeriodLabel}
                          compareLabel={comparePeriodLabel}
                        />
                      </th>
                      {columns.map((name) => (
                        <th key={`guide-${name}`} className="adc-th-channel adc-th-compare-guide">
                          <CompareColumnGuide
                            currentLabel={currentPeriodLabel}
                            compareLabel={comparePeriodLabel}
                          />
                        </th>
                      ))}
                    </tr>
                  )}
                </thead>
                <tbody>
                  {matrixRows.map((row) => {
                    const sliceMap = sliceMapForRow(row);
                    const compareEntry = compareEntryForDealer(compareByDealer, row.dealer);
                    const compareTotal = compareEntry?.total ?? 0;

                    return (
                      <tr key={row.dealer.id}>
                        <td className="adc-td-dealer">
                          <span className="adc-dealer-name" title={row.dealer.name}>
                            {row.dealer.name}
                          </span>
                          {row.error && (
                            <span className="adc-dealer-err" title={row.error}>
                              !
                            </span>
                          )}
                        </td>
                        <td className="adc-td-total">
                          {row.error ? (
                            <span className="adc-cell-empty">—</span>
                          ) : (
                            <CompareValueCell
                              current={row.total}
                              compare={compareTotal}
                              showCompare={showCompare}
                              comparePending={comparePending}
                              currentLabel={currentPeriodLabel}
                              compareLabel={comparePeriodLabel}
                            />
                          )}
                        </td>
                        {columns.map((colName) => (
                          <td key={`${row.dealer.id}-${colName}`} className="adc-td-channel">
                            <CompareValueCell
                              current={sliceMap.get(colName)?.value}
                              compare={compareEntry?.channels?.get(colName)?.value}
                              showCompare={showCompare}
                              comparePending={comparePending}
                              currentLabel={currentPeriodLabel}
                              compareLabel={comparePeriodLabel}
                            />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                  {tableBusy && matrixRows.length === 0 && (
                    <tr>
                      <td colSpan={Math.max(columns.length + 2, 3)} className="adc-loading-row">
                        Loading channel breakdown…
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </PanelBody>
      </Panel>
    </div>
  );
}
