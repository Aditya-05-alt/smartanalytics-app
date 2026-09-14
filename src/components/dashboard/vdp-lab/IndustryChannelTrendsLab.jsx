'use client';

/**
 * Compare page — industry VDP views by channel with MoM/YoY compare.
 * Reuses fetchAllDealersChannelMatrix (MV-backed) without touching Overview.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Panel, PanelHeader, PanelBody } from '@/components/dashboard/Panel';
import Delta from '@/components/dashboard/Delta';
import CalendarRangePicker from '@/components/dashboard/CalendarRangePicker';
import FilterDropdown from '@/components/dashboard/FilterDropdown';
import { Seg } from '@/components/campaigns/CampaignUi';
import { useClient } from '@/components/dashboard/ClientContext';
import DealerSelect from '@/components/dashboard/compare/DealerSelect';
import CompareCategorySelect from '@/components/dashboard/compare/CompareCategorySelect';
import {
  compareEntryForDealer,
  compareLookupFromRows,
  fetchAllDealersChannelMatrix,
  sliceMapForRow,
} from '@/lib/api/allDealerChannelMatrix';
import {
  EMPTY_COMPARE_SELECTION,
  compareVsSummary,
  createAllSelection,
  createCategorySelection,
  createDealerSelection,
  isSelectionReady,
  resolveSelectionDealers,
  selectionDealerNames,
  selectionLabel,
} from '@/lib/compare/compareSelection';
import { isAllDealerClient } from '@/lib/dashboard/allDealers';
import { readStoredOverviewDateRange } from '@/lib/dashboard/dashboardPrefs';
import { resolveDashboardDateRange } from '@/lib/dashboard/resolveDateRange';
import { VDP_CHANNEL_FILTER_OPTIONS, selectedChannels } from '@/lib/vdp/vdpFilterParams';
import {
  buildPortfolioTotalsRow,
  channelValue,
  industryCompareRanges,
  pickIndustryTrendColumnsForFilter,
  pctChange,
  sumChannelColumns,
} from '@/lib/vdp-lab/industryChannelTrends';

const PERIOD_MODE_OPTS = [
  { value: 'mom', label: 'MoM' },
  { value: 'yoy', label: 'YoY' },
];

function toChannelOpts(values) {
  return (values || ['All']).map((v) => ({
    value: v,
    label: v === 'All' ? 'All Channels' : v,
  }));
}

function selectedDealerIds(sel) {
  if (sel?.type !== 'dealers') return [];
  return (sel.dealerIds || []).map(String);
}

function withoutOverlap(sel, otherIds) {
  if (sel?.type !== 'dealers' || !otherIds?.length) return sel;
  const ban = new Set(otherIds.map(String));
  const next = (sel.dealerIds || []).filter((id) => !ban.has(String(id)));
  if (next.length === sel.dealerIds.length) return sel;
  return next.length
    ? createDealerSelection(next)
    : { ...EMPTY_COMPARE_SELECTION };
}

function uniqueDealers(list) {
  const seen = new Set();
  const out = [];
  for (const d of list || []) {
    const key = String(d?.id ?? d?.ga4CustomerId ?? '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out;
}

function dealerIdSet(dealers) {
  return new Set((dealers || []).map((d) => String(d.id)));
}

function shortMonthLabel(periodLabel) {
  if (!periodLabel) return '';
  const raw = String(periodLabel).trim();
  const monthYear = raw.match(/^([A-Za-z]{3,9})\s+(\d{4})$/);
  if (monthYear) {
    return `${monthYear[1].slice(0, 3).toUpperCase()} ${monthYear[2]}`;
  }
  const rangeStart = raw.match(/^([A-Za-z]{3,9})\s+\d{1,2},?\s+(\d{4})/);
  if (rangeStart) {
    return `${rangeStart[1].slice(0, 3).toUpperCase()} ${rangeStart[2]}`;
  }
  return raw.length > 10 ? `${raw.slice(0, 10)}…` : raw.toUpperCase();
}

function CompareCell({ current, prior, priorLabel, deltaLabel }) {
  const cur = Number(current) || 0;
  const prev = Number(prior) || 0;

  if (cur <= 0 && prev <= 0) {
    return <span className="vdp-lab-ict-empty">—</span>;
  }

  return (
    <div className="vdp-lab-ict-cell">
      <div className="vdp-lab-ict-prior">
        <span className="vdp-lab-ict-prior-lbl">{shortMonthLabel(priorLabel)}</span>
        <span className="vdp-lab-ict-prior-num">
          {prev > 0 ? prev.toLocaleString() : '—'}
        </span>
      </div>
      <div className="vdp-lab-ict-current">
        {cur > 0 ? cur.toLocaleString() : '—'}
      </div>
      <div className="vdp-lab-ict-yoy">
        <span className="vdp-lab-ict-yoy-lbl">{deltaLabel || 'YoY'}</span>
        <Delta value={pctChange(cur, prev)} size={10} />
      </div>
    </div>
  );
}

function sumMatrixTotals(rows, idSet, { channelFilterActive, columns }) {
  let total = 0;
  for (const row of rows || []) {
    if (idSet && !idSet.has(String(row.dealer?.id))) continue;
    if (channelFilterActive) {
      total += sumChannelColumns(sliceMapForRow(row), columns);
    } else {
      total += Number(row.total) || 0;
    }
  }
  return total;
}

function CompareKpi({
  mark,
  markClass,
  title,
  names,
  namesEmpty,
  current,
  prior,
  priorLabel,
  deltaLabel,
  hint,
  color,
  busy,
  ready,
}) {
  const cur = Number(current) || 0;
  const prev = Number(prior) || 0;
  const delta = pctChange(cur, prev);
  const valueTxt = busy ? '…' : ready ? cur.toLocaleString() : '—';

  return (
    <div className="kpi vdp-lab-ict-kpi" style={{ '--kc': color }}>
      <div className="kpi-l">
        <span className={`vdp-lab-ict-mark ${markClass}`}>{mark}</span>
        {title}
      </div>
      <NameChips names={names} empty={namesEmpty} />
      <div className="kpi-v">{valueTxt}</div>
      <div className="kpi-s">
        {ready && !busy ? (
          <>
            <Delta value={delta} /> {deltaLabel}
            <span className="vdp-lab-ict-kpi-prior">
              {shortMonthLabel(priorLabel) || 'Prior'}{' '}
              {prev > 0 ? prev.toLocaleString() : '—'}
            </span>
          </>
        ) : (
          <span>Total VDP</span>
        )}
      </div>
      {hint ? <div className="vdp-lab-ict-kpi-hint">{hint}</div> : null}
    </div>
  );
}

function NameChips({ names, empty = '—' }) {
  const list = (names || []).filter(Boolean);
  if (!list.length) {
    return <span className="vdp-lab-ict-chip vdp-lab-ict-chip--muted">{empty}</span>;
  }
  return (
    <div className="vdp-lab-ict-chips">
      {list.map((name) => (
        <span key={name} className="vdp-lab-ict-chip" title={name}>
          {name}
        </span>
      ))}
    </div>
  );
}

export default function IndustryChannelTrendsLab() {
  const {
    allDealers,
    loading: dealersLoading,
    dealerCategoryFilter,
  } = useClient();

  /** Left: dealers to list under the portfolio (Category vs Dealers). */
  const [leftSelection, setLeftSelection] = useState({
    ...EMPTY_COMPARE_SELECTION,
  });
  /** Right: Compare with dealers (cleared when Category is set). */
  const [rightSelection, setRightSelection] = useState(createAllSelection);
  /** Category overrides Compare with → portfolio aggregate. */
  const [compareCategories, setCompareCategories] = useState([]);
  const [channelFilter, setChannelFilter] = useState([]);
  const [dateRange, setDateRange] = useState(
    () => readStoredOverviewDateRange() || 'current_month'
  );
  const [periodMode, setPeriodMode] = useState('yoy');
  const [seeded, setSeeded] = useState(false);

  const [matrixRows, setMatrixRows] = useState([]);
  const [priorRows, setPriorRows] = useState([]);
  const [allColumns, setAllColumns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [loadPct, setLoadPct] = useState(0);
  const cancelRef = useRef(false);
  const loadGenRef = useRef(0);

  const selectableDealers = useMemo(
    () => (allDealers || []).filter((d) => d && !isAllDealerClient(d)),
    [allDealers]
  );

  useEffect(() => {
    if (seeded || dealersLoading) return;
    if (dealerCategoryFilter) {
      setCompareCategories([dealerCategoryFilter]);
      setRightSelection({ ...EMPTY_COMPARE_SELECTION });
    } else {
      setRightSelection(createAllSelection());
    }
    setSeeded(true);
  }, [seeded, dealersLoading, dealerCategoryFilter]);

  const { from, to } = useMemo(
    () => resolveDashboardDateRange(dateRange),
    [dateRange]
  );
  const comparePeriod = useMemo(
    () => industryCompareRanges(from, to, periodMode),
    [from, to, periodMode]
  );

  const categoryActive = compareCategories.length > 0;
  const effectiveRightSelection = useMemo(() => {
    if (categoryActive) return createCategorySelection(compareCategories);
    if (isSelectionReady(rightSelection)) return rightSelection;
    return createAllSelection();
  }, [categoryActive, compareCategories, rightSelection]);

  const leftDealers = useMemo(
    () =>
      resolveSelectionDealers(leftSelection, selectableDealers, {
        pageType: 'VDP',
      }),
    [leftSelection, selectableDealers]
  );

  const portfolioDealers = useMemo(
    () =>
      resolveSelectionDealers(effectiveRightSelection, selectableDealers, {
        pageType: 'VDP',
      }),
    [effectiveRightSelection, selectableDealers]
  );

  /** Fetch union so Category totals + selected dealers both have data. */
  const fetchDealers = useMemo(
    () => uniqueDealers([...portfolioDealers, ...leftDealers]),
    [portfolioDealers, leftDealers]
  );

  const portfolioTitle = useMemo(
    () =>
      selectionLabel(effectiveRightSelection, selectableDealers, {
        pageType: 'VDP',
      }) || 'All Dealers',
    [effectiveRightSelection, selectableDealers]
  );

  const leftReady = isSelectionReady(leftSelection);
  const categoryVsDealersMode = categoryActive && leftReady;

  const usingNames = useMemo(() => {
    if (leftReady) {
      return selectionDealerNames(leftSelection, selectableDealers);
    }
    return [];
  }, [leftReady, leftSelection, selectableDealers]);

  const comparedNames = useMemo(() => {
    return selectionDealerNames(effectiveRightSelection, selectableDealers);
  }, [effectiveRightSelection, selectableDealers]);

  const vsSummary = useMemo(() => {
    if (categoryVsDealersMode) {
      return (
        compareVsSummary(
          leftSelection,
          effectiveRightSelection,
          selectableDealers
        ) ||
        `${selectionLabel(leftSelection, selectableDealers)} vs ${portfolioTitle}`
      );
    }
    if (leftReady && isSelectionReady(effectiveRightSelection)) {
      return compareVsSummary(
        leftSelection,
        effectiveRightSelection,
        selectableDealers
      );
    }
    return portfolioTitle;
  }, [
    categoryVsDealersMode,
    leftReady,
    leftSelection,
    effectiveRightSelection,
    selectableDealers,
    portfolioTitle,
  ]);

  const channelFilterActive = selectedChannels(channelFilter).length > 0;
  const columns = useMemo(
    () => pickIndustryTrendColumnsForFilter(allColumns, channelFilter),
    [allColumns, channelFilter]
  );

  const panelTitle = categoryVsDealersMode
    ? `VDP views by channel — Category vs Dealers`
    : `VDP views by channel — ${portfolioTitle}`;
  const badgeLabel = `${String(comparePeriod.currentLabel || '').toUpperCase()} VS ${String(comparePeriod.priorLabel || '').toUpperCase()} · ${String(comparePeriod.deltaLabel || 'YoY').toUpperCase()}`;

  const categoryPlaceholder =
    compareCategories.length === 1
      ? `Using All ${compareCategories[0]}`
      : compareCategories.length > 1
        ? `Using ${compareCategories.length} categories`
        : null;

  const leftExcludeIds = selectedDealerIds(rightSelection);
  const rightExcludeIds = selectedDealerIds(leftSelection);

  const handleLeftDealers = (sel) => {
    setLeftSelection(sel);
    setRightSelection((right) => withoutOverlap(right, selectedDealerIds(sel)));
  };

  const handleRightDealers = (sel) => {
    setCompareCategories([]);
    setRightSelection(sel);
    setLeftSelection((left) => withoutOverlap(left, selectedDealerIds(sel)));
  };

  const handleCategory = (cats) => {
    const list = Array.isArray(cats) ? cats.filter(Boolean) : [];
    setCompareCategories(list);
    if (list.length) {
      setRightSelection({ ...EMPTY_COMPARE_SELECTION });
    } else if (!isSelectionReady(rightSelection)) {
      setRightSelection(createAllSelection());
    }
  };

  const load = useCallback(async () => {
    if (
      !fetchDealers.length ||
      !comparePeriod.currentFrom ||
      !comparePeriod.currentTo ||
      !comparePeriod.priorFrom ||
      !comparePeriod.priorTo
    ) {
      setMatrixRows([]);
      setPriorRows([]);
      setAllColumns([]);
      setLoading(false);
      setLoadPct(0);
      return;
    }

    const loadGen = loadGenRef.current + 1;
    loadGenRef.current = loadGen;
    cancelRef.current = false;
    const isStale = () => cancelRef.current || loadGenRef.current !== loadGen;

    setLoading(true);
    setError(null);
    setLoadPct(0);

    const progressCurrent = { completed: 0, total: 1 };
    const progressPrior = { completed: 0, total: 1 };
    const publish = () => {
      if (isStale()) return;
      const completed = progressCurrent.completed + progressPrior.completed;
      const total = Math.max(1, progressCurrent.total + progressPrior.total);
      setLoadPct(Math.min(99, Math.round((completed / total) * 100)));
    };

    try {
      const [current, prior] = await Promise.all([
        fetchAllDealersChannelMatrix({
          dealers: fetchDealers,
          from: comparePeriod.currentFrom,
          to: comparePeriod.currentTo,
          pageTypeFilter: 'VDP',
          onProgress: (p) => {
            progressCurrent.completed = p.completed;
            progressCurrent.total = Math.max(1, p.total);
            publish();
          },
          onCancelCheck: () => isStale(),
        }),
        fetchAllDealersChannelMatrix({
          dealers: fetchDealers,
          from: comparePeriod.priorFrom,
          to: comparePeriod.priorTo,
          pageTypeFilter: 'VDP',
          onProgress: (p) => {
            progressPrior.completed = p.completed;
            progressPrior.total = Math.max(1, p.total);
            publish();
          },
          onCancelCheck: () => isStale(),
        }),
      ]);

      if (isStale()) return;

      setAllColumns([
        ...new Set([...(current.columns || []), ...(prior.columns || [])]),
      ]);
      setMatrixRows(current.rows || []);
      setPriorRows(prior.rows || []);
      setError(current.warning || prior.warning || null);
    } catch (err) {
      if (!isStale()) {
        setError(err?.message || 'Failed to load industry channel trends.');
        setMatrixRows([]);
        setPriorRows([]);
        setAllColumns([]);
      }
    } finally {
      if (!isStale()) {
        setLoadPct(100);
        setLoading(false);
      }
    }
  }, [fetchDealers, comparePeriod]);

  useEffect(() => {
    if (dealersLoading || !seeded) return undefined;
    load();
    return () => {
      cancelRef.current = true;
    };
  }, [dealersLoading, seeded, load]);

  const priorLookup = useMemo(
    () => compareLookupFromRows(priorRows),
    [priorRows]
  );

  const portfolioIdSet = useMemo(
    () => dealerIdSet(portfolioDealers),
    [portfolioDealers]
  );
  const leftIdSet = useMemo(() => dealerIdSet(leftDealers), [leftDealers]);

  const displayRows = useMemo(() => {
    if (!matrixRows.length) return [];

    const portfolioSourceRows = matrixRows.filter((row) =>
      portfolioIdSet.has(String(row.dealer?.id))
    );
    const priorPortfolioSourceRows = priorRows.filter((row) =>
      portfolioIdSet.has(String(row.dealer?.id))
    );

    const portfolio = buildPortfolioTotalsRow(
      portfolioSourceRows,
      columns,
      portfolioTitle
    );
    const priorPortfolio = buildPortfolioTotalsRow(
      priorPortfolioSourceRows,
      columns,
      portfolioTitle
    );

    const withDisplayTotals = (row, priorSliceMap, priorTotalRaw) => {
      const sliceMap = sliceMapForRow(row);
      const currentTotal = channelFilterActive
        ? sumChannelColumns(sliceMap, columns)
        : Number(row.total) || 0;
      const priorTotal = channelFilterActive
        ? sumChannelColumns(priorSliceMap, columns)
        : Number(priorTotalRaw) || 0;
      return { currentTotal, priorTotal };
    };

    const portfolioPriorSlices = new Map(
      (priorPortfolio.slices || []).map((s) => [s.name, s.value])
    );
    const portfolioTotals = withDisplayTotals(
      portfolio,
      portfolioPriorSlices,
      priorPortfolio.total
    );

    // Category vs Dealers: show selected dealers under category totals.
    // Otherwise: show left dealers if picked, else everyone in the portfolio.
    let detailRows = matrixRows;
    if (leftReady) {
      detailRows = matrixRows.filter((row) =>
        leftIdSet.has(String(row.dealer?.id))
      );
    } else {
      detailRows = matrixRows.filter((row) =>
        portfolioIdSet.has(String(row.dealer?.id))
      );
    }

    const sorted = [...detailRows].sort((a, b) => {
      const aMap = sliceMapForRow(a);
      const bMap = sliceMapForRow(b);
      const aTotal = channelFilterActive
        ? sumChannelColumns(aMap, columns)
        : Number(a.total) || 0;
      const bTotal = channelFilterActive
        ? sumChannelColumns(bMap, columns)
        : Number(b.total) || 0;
      return bTotal - aTotal;
    });

    return [
      {
        ...portfolio,
        dealerCount: portfolioSourceRows.length,
        _displayTotal: portfolioTotals.currentTotal,
        _priorTotal: portfolioTotals.priorTotal,
        _priorSlices: portfolioPriorSlices,
      },
      ...sorted.map((row) => {
        const priorEntry = compareEntryForDealer(priorLookup, row.dealer);
        const priorSliceMap = priorEntry?.channels || new Map();
        const totals = withDisplayTotals(
          row,
          priorSliceMap,
          priorEntry?.total ?? 0
        );
        return {
          ...row,
          _displayTotal: totals.currentTotal,
          _priorTotal: totals.priorTotal,
          _priorSlices: priorSliceMap,
        };
      }),
    ];
  }, [
    matrixRows,
    priorRows,
    columns,
    portfolioTitle,
    channelFilterActive,
    priorLookup,
    portfolioIdSet,
    leftIdSet,
    leftReady,
  ]);

  const busy = dealersLoading || loading;
  const dataReady = !busy && matrixRows.length > 0;

  const cardTotals = useMemo(() => {
    const opts = { channelFilterActive, columns };
    const comparedCurrent = sumMatrixTotals(matrixRows, portfolioIdSet, opts);
    const comparedPrior = sumMatrixTotals(priorRows, portfolioIdSet, opts);
    const usingCurrent = leftReady
      ? sumMatrixTotals(matrixRows, leftIdSet, opts)
      : 0;
    const usingPrior = leftReady
      ? sumMatrixTotals(priorRows, leftIdSet, opts)
      : 0;

    const usingDelta = pctChange(usingCurrent, usingPrior);
    const comparedDelta = pctChange(comparedCurrent, comparedPrior);
    const vsComparedPct =
      leftReady && comparedCurrent > 0
        ? Math.round((usingCurrent / comparedCurrent) * 1000) / 10
        : null;

    return {
      usingCurrent,
      usingPrior,
      usingDelta,
      comparedCurrent,
      comparedPrior,
      comparedDelta,
      vsComparedPct,
    };
  }, [
    matrixRows,
    priorRows,
    portfolioIdSet,
    leftIdSet,
    leftReady,
    channelFilterActive,
    columns,
  ]);

  return (
    <div className="vdp-lab-ict-wrap">
      <div
        className={`filters compare-page-filters dealer-compare-filters vdp-lab-ict-filters${
          busy ? ' dealer-compare-filters--busy' : ''
        }`}
        aria-busy={busy || undefined}
      >
        <div className="dealer-compare-side">
          <span className="dealer-compare-side-title">Dealer</span>
          <DealerSelect
            label={null}
            dealers={selectableDealers}
            value={leftSelection}
            onChange={handleLeftDealers}
            excludeDealerIds={leftExcludeIds}
            allowAllDealers={false}
            placeholder={
              dealersLoading ? 'Loading…' : 'Select dealer(s) to compare'
            }
            disabled={dealersLoading || busy}
          />
        </div>
        <div className="dealer-compare-side">
          <span className="dealer-compare-side-title">Compare with</span>
          <DealerSelect
            label={null}
            dealers={selectableDealers}
            value={categoryActive ? EMPTY_COMPARE_SELECTION : rightSelection}
            onChange={handleRightDealers}
            excludeDealerIds={rightExcludeIds}
            allowAllDealers
            placeholder={
              categoryPlaceholder
                ? categoryPlaceholder
                : dealersLoading
                  ? 'Loading…'
                  : 'Select dealer(s)'
            }
            disabled={dealersLoading || busy || categoryActive}
          />
        </div>
        <CompareCategorySelect
          dealers={selectableDealers}
          value={compareCategories}
          onChange={handleCategory}
          disabled={dealersLoading || busy}
          label="Category"
        />
        <div className="dealer-compare-channel-filter">
          <span className="dealer-compare-side-title">Channel</span>
          <FilterDropdown
            multi
            clearable
            options={toChannelOpts(VDP_CHANNEL_FILTER_OPTIONS)}
            value={channelFilter}
            onChange={setChannelFilter}
            disabled={busy}
          />
        </div>
        <div className="dealer-compare-date-filter">
          <span className="dealer-compare-side-title">Date range</span>
          <div className="vdp-lab-ict-date-row">
            <CalendarRangePicker value={dateRange} onChange={setDateRange} />
            <div className="vdp-lab-ict-period-switch">
              <span className="dealer-compare-side-title">Period</span>
              <Seg
                value={periodMode}
                options={PERIOD_MODE_OPTS}
                onChange={setPeriodMode}
              />
            </div>
          </div>
        </div>
        <div className="dealer-compare-dealers-summary">
          <span className="dealer-compare-side-title">Category vs Dealers</span>
          <div
            className="dealer-compare-vs-label"
            title={vsSummary || undefined}
          >
            {vsSummary || '—'}
          </div>
        </div>
      </div>

      <div className="vdp-lab-ict-kpis" aria-label="VDP comparison">
        <div className="vdp-lab-ict-kpis-head">
          From VDP · {comparePeriod.deltaLabel} · {comparePeriod.currentLabel} vs{' '}
          {comparePeriod.priorLabel}
        </div>
        <div className="kpi-row vdp-lab-ict-kpi-row">
          <CompareKpi
            mark="Using"
            markClass="vdp-lab-ict-mark--using"
            title="Total VDP · dealer(s) in focus"
            names={usingNames}
            namesEmpty="Pick Dealer(s) to mark as Using"
            current={cardTotals.usingCurrent}
            prior={cardTotals.usingPrior}
            priorLabel={comparePeriod.priorLabel}
            deltaLabel={comparePeriod.deltaLabel}
            color="var(--acc)"
            busy={busy && leftReady}
            ready={leftReady && dataReady}
            hint={
              leftReady
                ? `${usingNames.length} dealer${usingNames.length === 1 ? '' : 's'}${
                    dataReady && cardTotals.vsComparedPct != null
                      ? ` · ${cardTotals.vsComparedPct}% of Compared with`
                      : ''
                  }`
                : null
            }
          />
          <CompareKpi
            mark="Compared with"
            markClass="vdp-lab-ict-mark--compared"
            title={`Total VDP · ${categoryActive ? 'Category' : 'Benchmark'}`}
            names={comparedNames}
            namesEmpty="Pick Compare with / Category"
            current={cardTotals.comparedCurrent}
            prior={cardTotals.comparedPrior}
            priorLabel={comparePeriod.priorLabel}
            deltaLabel={comparePeriod.deltaLabel}
            color="#60a5fa"
            busy={busy}
            ready={dataReady || (!busy && portfolioDealers.length > 0)}
            hint={`Pinned totals · ${portfolioDealers.length} dealer${
              portfolioDealers.length === 1 ? '' : 's'
            }${categoryActive ? ` · ${portfolioTitle}` : ''}`}
          />
        </div>
      </div>

      <Panel className="vdp-lab-ict-panel">
        <PanelHeader
          title={panelTitle}
          badge={{
            label: badgeLabel,
            bg: 'var(--s3)',
            color: 'var(--t2)',
          }}
        />
        <PanelBody className="vdp-lab-ict-body">
          <p className="vdp-lab-ict-note">
            Using vs Compared with. Switch MoM / YoY next to Date range.
          </p>

          {error && (
            <div className="donut-err" role="alert">
              {error}
            </div>
          )}

          {busy && (
            <div
              className="vdp-lab-ict-loading"
              role="status"
              aria-live="polite"
              aria-busy="true"
              aria-label={`Loading ${loadPct}%`}
            >
              <div className="adc-table-loader dealer-compare-loader">
                <span className="adc-table-spinner" aria-hidden />
                <span className="adc-table-loader-text">Loading {loadPct}%</span>
              </div>
            </div>
          )}

          {!busy && !error && !fetchDealers.length && (
            <div className="local-empty-state">
              <p className="local-empty-title">No dealers for industry trends</p>
              <p className="local-empty-sub">
                Pick Category and/or Dealers, and ensure All Dealers → VDP is
                enabled in Admin.
              </p>
            </div>
          )}

          {dataReady && (
            <div className="adc-table-stage vdp-lab-ict-stage">
              <div className="adc-table-wrap vdp-lab-ict-table-wrap">
                <table className="tbl adc-table adc-table--compare vdp-lab-ict-table">
                  <thead>
                    <tr>
                      <th className="adc-th-dealer">Dealer</th>
                      <th className="adc-th-total">
                        <span className="vdp-lab-ict-col-head">Total VDP Views</span>
                      </th>
                      {columns.map((name) => (
                        <th key={name} className="adc-th-channel">
                          <span className="vdp-lab-ict-col-head" title={name}>
                            {name}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {displayRows.map((row) => {
                      const isPortfolio = Boolean(row.isPortfolio);
                      const isUsing =
                        !isPortfolio &&
                        leftReady &&
                        leftIdSet.has(String(row.dealer?.id));
                      const isComparedMember =
                        !isPortfolio &&
                        !isUsing &&
                        portfolioIdSet.has(String(row.dealer?.id));
                      const sliceMap = sliceMapForRow(row);
                      const priorSliceMap = row._priorSlices || new Map();

                      return (
                        <tr
                          key={row.dealer.id}
                          className={
                            isPortfolio
                              ? 'vdp-lab-ict-row--portfolio'
                              : isUsing
                                ? 'vdp-lab-ict-row--using'
                                : undefined
                          }
                        >
                          <td className="adc-td-dealer">
                            <span
                              className="adc-dealer-name"
                              title={row.dealer.name}
                            >
                              {row.dealer.name}
                            </span>
                            {isPortfolio && (
                              <span className="vdp-lab-ict-dealer-meta">
                                <span className="vdp-lab-ict-mark vdp-lab-ict-mark--compared">
                                  Compared with
                                </span>
                                {row.dealerCount} dealers
                              </span>
                            )}
                            {isUsing && (
                              <span className="vdp-lab-ict-dealer-meta">
                                <span className="vdp-lab-ict-mark vdp-lab-ict-mark--using">
                                  Using
                                </span>
                              </span>
                            )}
                            {isComparedMember && (
                              <span className="vdp-lab-ict-dealer-meta">
                                <span className="vdp-lab-ict-mark vdp-lab-ict-mark--compared-soft">
                                  Compared with
                                </span>
                              </span>
                            )}
                          </td>
                          <td className="adc-td-total">
                            <CompareCell
                              current={row._displayTotal}
                              prior={row._priorTotal}
                              priorLabel={comparePeriod.priorLabel}
                              deltaLabel={comparePeriod.deltaLabel}
                            />
                          </td>
                          {columns.map((ch) => (
                            <td key={ch} className="adc-td-channel">
                              <CompareCell
                                current={channelValue(sliceMap, ch)}
                                prior={channelValue(priorSliceMap, ch)}
                                priorLabel={comparePeriod.priorLabel}
                                deltaLabel={comparePeriod.deltaLabel}
                              />
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </PanelBody>
      </Panel>
    </div>
  );
}
