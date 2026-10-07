'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Panel, PanelHeader, PanelBody } from '@/components/dashboard/Panel';
import { writeStoredDealerId } from '@/lib/dashboard/dashboardPrefs';
import Delta from '@/components/dashboard/Delta';
import { useClient } from '@/components/dashboard/ClientContext';
import { useOverview } from '@/components/dashboard/overview/OverviewDataContext';
import { useAllDealerMatrix } from '@/components/dashboard/overview/AllDealerMatrixContext';
import {
  fetchAllDealersChannelMatrix,
  sliceMapForRow,
} from '@/lib/api/allDealerChannelMatrix';
import { normalizeChannelKey } from '@/lib/ga4/channelGroups';
import {
  pctChange,
  previousMonthAlignedRange,
  previousFullMonthRange,
  periodMonthLabel,
  formatRangeLabel,
} from '@/lib/overview/comparePeriod';

const PAID_SEARCH_ALIASES = ['Paid Search'];
const CROSS_NETWORK_ALIASES = ['Cross-network', 'Cross Network'];
const DISPLAY_ALIASES = ['Display'];

function dealerIncludedOnVdp(dealer) {
  return dealer?.showAllDealersVdp !== false;
}

function sumAliases(sliceMap, aliases) {
  const wanted = new Set(aliases.map((a) => normalizeChannelKey(a)));
  let total = 0;
  for (const [name, slice] of sliceMap.entries()) {
    if (wanted.has(normalizeChannelKey(name))) {
      total += Number(slice?.value) || 0;
    }
  }
  return total;
}

function channelMetrics(row) {
  const sliceMap = sliceMapForRow(row);
  const paidSearch = sumAliases(sliceMap, PAID_SEARCH_ALIASES);
  const crossNetwork = sumAliases(sliceMap, CROSS_NETWORK_ALIASES);
  const display = sumAliases(sliceMap, DISPLAY_ALIASES);
  return {
    paidSearch,
    crossNetwork,
    display,
    paidPlusCross: paidSearch + crossNetwork,
    totalVdp: Number(row?.total) || 0,
  };
}

function parseISODate(iso) {
  if (!iso) return null;
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * (Current VDP / current days elapsed in month) × days in that month (28–31).
 */
function monthEndProjectionFactors(from, to) {
  const end = parseISODate(to);
  if (!end) return { currentDays: 0, daysInMonth: 0 };

  const y = end.getFullYear();
  const m = end.getMonth();
  const daysInMonth = new Date(y, m + 1, 0).getDate(); // 28–31
  const start = parseISODate(from);
  const monthStart = new Date(y, m, 1);

  // Prefer day-of-month of range end when range starts at/before month start.
  let currentDays = end.getDate();
  if (start && start > monthStart) {
    const msPerDay = 24 * 60 * 60 * 1000;
    currentDays = Math.round((end.getTime() - start.getTime()) / msPerDay) + 1;
  }

  return {
    currentDays: Math.max(1, Math.min(daysInMonth, currentDays)),
    daysInMonth,
  };
}

function expectedVdpTillMonthEnd(totalVdp, currentDays, daysInMonth) {
  if (!currentDays || !daysInMonth) return 0;
  const vdp = Number(totalVdp) || 0;
  if (vdp <= 0) return 0;
  return Math.round((vdp / currentDays) * daysInMonth);
}

function shortPeriodTag(label) {
  if (!label) return '';
  const raw = String(label).trim();
  const monthYear = raw.match(/^([A-Za-z]{3,9})\s+(\d{4})$/);
  if (monthYear) return `${monthYear[1].slice(0, 3)} ${monthYear[2]}`;
  const rangeStart = raw.match(/^([A-Za-z]{3,9})\s+\d{1,2},?\s+(\d{4})/);
  if (rangeStart) return `${rangeStart[1].slice(0, 3)} ${rangeStart[2]}`;
  return raw.length > 10 ? `${raw.slice(0, 10)}…` : raw;
}

function dayOrdinal(n) {
  const j = n % 10;
  const k = n % 100;
  if (j === 1 && k !== 11) return 'st';
  if (j === 2 && k !== 12) return 'nd';
  if (j === 3 && k !== 13) return 'rd';
  return 'th';
}

/** "Sep 21st" */
function dayStamp(iso) {
  const d = parseISODate(iso);
  if (!d) return '';
  const day = d.getDate();
  const mon = d.toLocaleDateString('en-US', { month: 'short' });
  return `${mon} ${day}${dayOrdinal(day)}`;
}

/** "Sep 1st–21st" or "Sep 21st" when single day. */
function shortDayRange(from, to) {
  const a = parseISODate(from);
  const b = parseISODate(to);
  if (!a || !b) return '';
  if (from === to) return dayStamp(from);
  const sameMonth =
    a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
  if (sameMonth) {
    const mon = a.toLocaleDateString('en-US', { month: 'short' });
    return `${mon} ${a.getDate()}${dayOrdinal(a.getDate())}–${b.getDate()}${dayOrdinal(b.getDate())}`;
  }
  return `${dayStamp(from)}–${dayStamp(to)}`;
}

function ViewsCell({ value }) {
  const n = Number(value) || 0;
  if (n <= 0) return <span className="adc-cell-empty">—</span>;
  return (
    <div className="adc-cell">
      <span className="adc-cell-views">{n.toLocaleString()}</span>
    </div>
  );
}

function ComparePeriodCell({
  current,
  previous,
  pending,
  currentLabel,
  previousLabel,
  deltaLabel,
}) {
  const cur = Number(current) || 0;
  const prev = Number(previous) || 0;

  if (pending) {
    return (
      <div className="adc-compare-stack">
        <div className="adc-compare-line">
          <span className="adc-compare-lbl">{shortPeriodTag(previousLabel) || 'Prev'}</span>
          <span className="adc-compare-pending">…</span>
        </div>
      </div>
    );
  }

  if (cur <= 0 && prev <= 0) {
    return <span className="adc-cell-empty">—</span>;
  }

  return (
    <div className="adc-compare-stack">
      <div className="adc-compare-line">
        <span className="adc-compare-lbl" title={currentLabel}>
          {shortPeriodTag(currentLabel) || 'Cur'}
        </span>
        <span className="adc-compare-num adc-compare-num--cur">
          {cur > 0 ? cur.toLocaleString() : '—'}
        </span>
      </div>
      <div className="adc-compare-line">
        <span className="adc-compare-lbl" title={previousLabel}>
          {shortPeriodTag(previousLabel) || 'Prev'}
        </span>
        <span className="adc-compare-num adc-compare-num--prev">
          {prev > 0 ? prev.toLocaleString() : '—'}
        </span>
      </div>
      <div className="adc-compare-line adc-compare-line--pct">
        <span className="adc-compare-lbl">{deltaLabel}</span>
        <span className="adc-compare-pct">
          <Delta value={pctChange(cur, prev)} size={10} />
        </span>
      </div>
    </div>
  );
}

/**
 * External All Dealers matrix — fixed columns:
 * Dealers | Total VDP | Expected VDP | Paid Search | Cross Network | Display |
 * Paid Search + Cross Network | Expected VDP (Paid Search + Cross)
 * PoP / MoM compare (toolbar switch) stacks into VDP + channel cells.
 */
export default function AllDealersFocusedTable({
  selectedDealerNames = [],
  compareMode = null,
}) {
  const { dealers, loading: dealersLoading, dealerCategoryFilter } = useClient();

  // Only the stored selection is written: this page resets the live client to All Dealers,
  // and Overview resolves its dealer from storage on navigation.
  const openDealerOverview = useCallback((dealer) => {
    if (dealer?.id != null) writeStoredDealerId(dealer.id);
  }, []);
  const { setSnapshot } = useAllDealerMatrix();
  const { from, to } = useOverview();

  const [currentRows, setCurrentRows] = useState([]);
  const [popRows, setPopRows] = useState([]);
  const [momRows, setMomRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const cancelRef = useRef(false);
  const loadGenRef = useRef(0);

  const portfolioDealers = useMemo(
    () => (dealers || []).filter((d) => dealerIncludedOnVdp(d)),
    [dealers]
  );

  const popRange = useMemo(
    () => previousMonthAlignedRange(from, to),
    [from, to]
  );
  const momRange = useMemo(() => previousFullMonthRange(from, to), [from, to]);

  const currentLabel = useMemo(
    () => periodMonthLabel(from, to) || formatRangeLabel(from, to),
    [from, to]
  );
  const popLabel = useMemo(
    () =>
      periodMonthLabel(popRange.compareFrom, popRange.compareTo)
      || formatRangeLabel(popRange.compareFrom, popRange.compareTo),
    [popRange]
  );
  const momLabel = useMemo(
    () =>
      periodMonthLabel(momRange.compareFrom, momRange.compareTo)
      || formatRangeLabel(momRange.compareFrom, momRange.compareTo),
    [momRange]
  );

  const { currentDays, daysInMonth } = useMemo(
    () => monthEndProjectionFactors(from, to),
    [from, to]
  );

  const wantPop = compareMode === 'pop';
  const wantMom = compareMode === 'mom';
  const compareActive = wantPop || wantMom;
  const compareLabel = wantPop ? popLabel : momLabel;
  const deltaLabel = wantPop ? 'PoP' : 'MoM';

  const loadMatrix = useCallback(async () => {
    if (!portfolioDealers?.length || !from || !to) {
      setCurrentRows([]);
      setPopRows([]);
      setMomRows([]);
      return;
    }

    const loadGen = loadGenRef.current + 1;
    loadGenRef.current = loadGen;
    cancelRef.current = false;
    setLoading(true);
    setError(null);

    const isStale = () => cancelRef.current || loadGenRef.current !== loadGen;

    try {
      const currentPromise = fetchAllDealersChannelMatrix({
        dealers: portfolioDealers,
        from,
        to,
        pageTypeFilter: 'VDP',
        onCancelCheck: () => isStale(),
      });

      const popPromise =
        wantPop && popRange.compareFrom && popRange.compareTo
          ? fetchAllDealersChannelMatrix({
              dealers: portfolioDealers,
              from: popRange.compareFrom,
              to: popRange.compareTo,
              pageTypeFilter: 'VDP',
              onCancelCheck: () => isStale(),
            })
          : Promise.resolve({ rows: [], warning: null });

      const momPromise =
        wantMom && momRange.compareFrom && momRange.compareTo
          ? fetchAllDealersChannelMatrix({
              dealers: portfolioDealers,
              from: momRange.compareFrom,
              to: momRange.compareTo,
              pageTypeFilter: 'VDP',
              onCancelCheck: () => isStale(),
            })
          : Promise.resolve({ rows: [], warning: null });

      const [current, pop, mom] = await Promise.all([
        currentPromise,
        popPromise,
        momPromise,
      ]);

      if (isStale()) return;

      setCurrentRows(current.rows || []);
      setPopRows(wantPop ? pop.rows || [] : []);
      setMomRows(wantMom ? mom.rows || [] : []);
      setError(current.warning || pop.warning || mom.warning || null);
    } catch (err) {
      if (!isStale()) {
        setError(err?.message || 'Failed to load dealer channel data.');
        setCurrentRows([]);
        setPopRows([]);
        setMomRows([]);
      }
    } finally {
      if (!isStale()) setLoading(false);
    }
  }, [
    portfolioDealers,
    from,
    to,
    popRange,
    momRange,
    wantPop,
    wantMom,
  ]);

  useEffect(() => {
    if (dealersLoading) return undefined;
    loadMatrix();
    return () => {
      cancelRef.current = true;
    };
  }, [dealersLoading, loadMatrix]);

  const compareByDealer = useMemo(() => {
    const source = wantPop ? popRows : wantMom ? momRows : [];
    const map = new Map();
    for (const row of source) {
      const id = row?.dealer?.id;
      if (id != null) map.set(id, channelMetrics(row));
    }
    return map;
  }, [wantPop, wantMom, popRows, momRows]);

  const displayRows = useMemo(() => {
    const names = (selectedDealerNames || []).filter(Boolean);
    const allow = names.length ? new Set(names) : null;
    const rows = (currentRows.length
      ? currentRows
      : portfolioDealers.map((dealer) => ({
          dealer,
          slices: [],
          total: 0,
          error: null,
        }))
    )
      .filter((row) => !allow || allow.has(row?.dealer?.name))
      .map((row) => ({
        ...row,
        metrics: channelMetrics(row),
      }));
    rows.sort((a, b) =>
      String(a.dealer?.name || '').localeCompare(String(b.dealer?.name || ''))
    );
    return rows;
  }, [currentRows, portfolioDealers, selectedDealerNames]);

  const dataReady = !loading && currentRows.length > 0;
  const showCompareStack = compareActive && dataReady && !loading;

  useEffect(() => {
    setSnapshot({
      matrixRows: currentRows,
      compareMatrixRows: wantPop ? popRows : wantMom ? momRows : [],
      columns: [
        'Paid Search',
        'Cross Network',
        'Display',
        'Paid Search + Cross Network',
        'Expected VDP Paid Search + Cross Network',
      ],
      loading: dealersLoading || loading,
      compareLoading: loading,
      ready: dataReady,
    });
  }, [
    currentRows,
    popRows,
    momRows,
    wantPop,
    wantMom,
    dealersLoading,
    loading,
    dataReady,
    setSnapshot,
  ]);

  const panelTitle = dealerCategoryFilter
    ? `VDP views — ${dealerCategoryFilter} dealers (Paid Search focus)`
    : 'VDP views — all dealers (Paid Search focus)';

  const showEmpty =
    !loading && !error && !dealersLoading && !portfolioDealers.length;

  const compareRange = wantPop ? popRange : momRange;
  const compareDatesCaption = compareActive
    ? `${shortDayRange(from, to)} vs ${shortDayRange(
        compareRange.compareFrom,
        compareRange.compareTo
      )}`
    : '';

  const expectedHint =
    currentDays && daysInMonth
      ? `(Total VDP ÷ ${currentDays}) × ${daysInMonth}`
      : 'Expected VDP Till Month End';

  const expectedPaidCrossHint =
    currentDays && daysInMonth
      ? `(Paid Search + Cross ÷ ${currentDays}) × ${daysInMonth}`
      : 'Expected VDP Till Month End (Paid Search + Cross Network)';

  const badgeLabel = `${currentLabel} · Expected`;

  function MetricCell({ current, previous, pending }) {
    if (compareActive) {
      return (
        <ComparePeriodCell
          current={current}
          previous={previous}
          pending={pending}
          currentLabel={currentLabel}
          previousLabel={compareLabel}
          deltaLabel={deltaLabel}
        />
      );
    }
    if (pending) return <span className="adc-cell-empty">—</span>;
    return <ViewsCell value={current} />;
  }

  return (
    <div className="content all-dealer-overview-content">
      <Panel className="all-dealer-channel-panel">
        <PanelHeader
          title={panelTitle}
          badge={{
            label: badgeLabel,
            bg: 'var(--s3)',
            color: 'var(--t2)',
          }}
        >
          {compareActive && compareDatesCaption ? (
            <span
              className="ph-compare-dates"
              title={`${deltaLabel}: ${compareDatesCaption}`}
            >
              {compareDatesCaption}
            </span>
          ) : null}
        </PanelHeader>
        <PanelBody className="all-dealer-channel-body">
          {loading && (
            <div
              className="adc-nav-progress adc-nav-progress--table-top"
              role="progressbar"
              aria-label="Loading"
              aria-busy="true"
            >
              <div className="adc-nav-progress-bar" />
            </div>
          )}
          {error && (
            <div className="donut-err" role="alert">
              {error}
            </div>
          )}
          {showEmpty && (
            <div className="local-empty-state">
              <p className="local-empty-title">No dealer channel data</p>
              <p className="local-empty-sub">
                {dealerCategoryFilter && !dealers?.length
                  ? `No active dealers are tagged as ${dealerCategoryFilter}.`
                  : 'No dealers enabled for All Dealers → VDP.'}
              </p>
            </div>
          )}
          {displayRows.length > 0 && (
            <div className={`adc-table-stage${loading ? ' adc-table-stage--busy' : ''}`}>
              <div className="adc-table-wrap adc-table-wrap--focused">
                <table
                  className={`tbl adc-table${showCompareStack ? ' adc-table--compare' : ''} adc-table--focused${loading ? ' adc-table--loading' : ''}`}
                >
                  <thead>
                    <tr>
                      <th className="adc-th-dealer">Dealers</th>
                      <th className="adc-th-total">
                        <div className="adc-col-head">
                          <span className="adc-col-label">Total VDP</span>
                        </div>
                      </th>
                      <th className="adc-th-total adc-th-expected" title={expectedHint}>
                        <div className="adc-col-head">
                          <span className="adc-col-label">
                            <span className="adc-col-label-line">Expected VDP</span>
                            <span className="adc-col-label-line">Till Month End</span>
                          </span>
                        </div>
                      </th>
                      <th className="adc-th-channel">
                        <div className="adc-col-head">
                          <span className="adc-col-label">Paid Search</span>
                        </div>
                      </th>
                      <th className="adc-th-channel">
                        <div className="adc-col-head">
                          <span className="adc-col-label">Cross Network</span>
                        </div>
                      </th>
                      <th className="adc-th-channel">
                        <div className="adc-col-head">
                          <span className="adc-col-label">Display</span>
                        </div>
                      </th>
                      <th className="adc-th-channel">
                        <div className="adc-col-head">
                          <span className="adc-col-label">
                            <span className="adc-col-label-line">Paid Search +</span>
                            <span className="adc-col-label-line">Cross Network</span>
                          </span>
                        </div>
                      </th>
                      <th
                        className="adc-th-total adc-th-expected"
                        title={expectedPaidCrossHint}
                      >
                        <div className="adc-col-head">
                          <span className="adc-col-label">
                            <span className="adc-col-label-line">Expected VDP</span>
                            <span className="adc-col-label-line">Paid + Cross</span>
                          </span>
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayRows.map((row) => {
                      const m = row.metrics;
                      const cmp = compareByDealer.get(row.dealer.id);
                      const pending = !dataReady || loading || row.error;
                      const expected = expectedVdpTillMonthEnd(
                        m.totalVdp,
                        currentDays,
                        daysInMonth
                      );
                      const expectedPaidCross = expectedVdpTillMonthEnd(
                        m.paidPlusCross,
                        currentDays,
                        daysInMonth
                      );

                      return (
                        <tr key={row.dealer.id}>
                          <td className="adc-td-dealer">
                            <Link
                              href="/dashboard"
                              className="adc-dealer-name adc-dealer-link"
                              title={`Open ${row.dealer.name} in Overview`}
                              onClick={() => openDealerOverview(row.dealer)}
                              onAuxClick={() => openDealerOverview(row.dealer)}
                            >
                              {row.dealer.name}
                            </Link>
                            {dataReady && row.error && (
                              <span className="adc-dealer-err" title={row.error}>
                                !
                              </span>
                            )}
                          </td>
                          <td className="adc-td-total">
                            <MetricCell
                              current={m.totalVdp}
                              previous={cmp?.totalVdp}
                              pending={pending}
                            />
                          </td>
                          <td className="adc-td-total adc-td-expected" title={expectedHint}>
                            {pending ? (
                              <span className="adc-cell-empty">—</span>
                            ) : (
                              <ViewsCell value={expected} />
                            )}
                          </td>
                          <td className="adc-td-channel">
                            <MetricCell
                              current={m.paidSearch}
                              previous={cmp?.paidSearch}
                              pending={pending}
                            />
                          </td>
                          <td className="adc-td-channel">
                            <MetricCell
                              current={m.crossNetwork}
                              previous={cmp?.crossNetwork}
                              pending={pending}
                            />
                          </td>
                          <td className="adc-td-channel">
                            <MetricCell
                              current={m.display}
                              previous={cmp?.display}
                              pending={pending}
                            />
                          </td>
                          <td className="adc-td-channel">
                            <MetricCell
                              current={m.paidPlusCross}
                              previous={cmp?.paidPlusCross}
                              pending={pending}
                            />
                          </td>
                          <td
                            className="adc-td-total adc-td-expected"
                            title={expectedPaidCrossHint}
                          >
                            {pending ? (
                              <span className="adc-cell-empty">—</span>
                            ) : (
                              <ViewsCell value={expectedPaidCross} />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {loading && (
                <div
                  className="adc-table-overlay"
                  role="status"
                  aria-live="polite"
                  aria-busy="true"
                >
                  <div className="adc-table-loader">
                    <span>Loading…</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </PanelBody>
      </Panel>
    </div>
  );
}
