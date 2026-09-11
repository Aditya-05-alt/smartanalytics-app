'use client';

import { useEffect, useMemo, useState } from 'react';
import CalendarRangePicker from '@/components/dashboard/CalendarRangePicker';
import FilterDropdown from '@/components/dashboard/FilterDropdown';
import { useClient } from '@/components/dashboard/ClientContext';
import DealerSelect from '@/components/dashboard/compare/DealerSelect';
import CompareCategorySelect from '@/components/dashboard/compare/CompareCategorySelect';
import DealerCompareChannelTable from '@/components/dashboard/compare/DealerCompareChannelTable';
import { isAllDealerClient } from '@/lib/dashboard/allDealers';
import {
  EMPTY_COMPARE_SELECTION,
  compareVsSummary,
  createCategorySelection,
  selectionFromDealer,
} from '@/lib/compare/compareSelection';
import { VDP_CHANNEL_FILTER_OPTIONS } from '@/lib/vdp/vdpFilterParams';
import {
  readStoredOverviewDateRange,
  writeStoredOverviewDateRange,
} from '@/lib/dashboard/dashboardPrefs';
import { resolveDashboardDateRange } from '@/lib/dashboard/resolveDateRange';

function toChannelOpts(values) {
  return (values || ['All']).map((v) => ({
    value: v,
    label: v === 'All' ? 'All Channels' : v,
  }));
}

function pruneDealerSelection(sel, validIds) {
  if (sel?.type !== 'dealers') return sel;
  const next = (sel.dealerIds || []).filter((id) => validIds.has(String(id)));
  if (next.length === sel.dealerIds.length) return sel;
  return next.length
    ? { type: 'dealers', category: null, dealerIds: next }
    : { ...EMPTY_COMPARE_SELECTION };
}

/** Dealer ids currently selected (dealers mode only). */
function selectedDealerIds(sel) {
  if (sel?.type !== 'dealers') return [];
  return (sel.dealerIds || []).map(String);
}

/** Drop any dealer ids that appear on the other compare side. */
function withoutOverlap(sel, otherIds) {
  if (sel?.type !== 'dealers' || !otherIds?.length) return sel;
  const ban = new Set(otherIds.map(String));
  const next = (sel.dealerIds || []).filter((id) => !ban.has(String(id)));
  if (next.length === sel.dealerIds.length) return sel;
  return next.length
    ? { type: 'dealers', category: null, dealerIds: next }
    : { ...EMPTY_COMPARE_SELECTION };
}

export default function ComparePage() {
  const {
    client,
    allDealers,
    loading: dealersLoading,
  } = useClient();
  const [dateRange, setDateRange] = useState(
    () => readStoredOverviewDateRange() || 'current_month'
  );
  const [leftSelection, setLeftSelection] = useState(EMPTY_COMPARE_SELECTION);
  const [rightSelection, setRightSelection] = useState(EMPTY_COMPARE_SELECTION);
  /** Categories for Compare with (empty = use dealer picker). */
  const [compareCategories, setCompareCategories] = useState([]);
  const [channelFilter, setChannelFilter] = useState([]);
  const [seeded, setSeeded] = useState(false);

  const [compareLoading, setCompareLoading] = useState(false);

  const selectableDealers = useMemo(
    () => (allDealers || []).filter((d) => d && !isAllDealerClient(d)),
    [allDealers]
  );

  useEffect(() => {
    if (seeded || dealersLoading || !selectableDealers.length) return;
    if (client && !isAllDealerClient(client)) {
      const match = selectableDealers.find((d) => d.id === client.id);
      if (match) {
        setLeftSelection(selectionFromDealer(match));
        setSeeded(true);
        return;
      }
    }
    setLeftSelection(selectionFromDealer(selectableDealers[0]));
    setSeeded(true);
  }, [seeded, dealersLoading, selectableDealers, client]);

  useEffect(() => {
    const valid = new Set(selectableDealers.map((d) => String(d.id)));
    setLeftSelection((sel) => {
      if (sel?.type === 'all') return { ...EMPTY_COMPARE_SELECTION };
      return pruneDealerSelection(sel, valid);
    });
    setRightSelection((sel) => {
      if (sel?.type === 'all') return { ...EMPTY_COMPARE_SELECTION };
      return pruneDealerSelection(sel, valid);
    });
  }, [selectableDealers]);

  useEffect(() => {
    writeStoredOverviewDateRange(dateRange);
  }, [dateRange]);

  // Strip self-compare if both sides already share a dealer (e.g. prior session).
  useEffect(() => {
    const leftIds = selectedDealerIds(leftSelection);
    if (!leftIds.length) return;
    setRightSelection((right) => withoutOverlap(right, leftIds));
  }, [leftSelection]);

  const { from, to } = resolveDashboardDateRange(dateRange);

  // Category overrides Compare-with dealers when set.
  const effectiveRightSelection = useMemo(() => {
    if (compareCategories.length) return createCategorySelection(compareCategories);
    return rightSelection;
  }, [compareCategories, rightSelection]);

  const handleLeftDealers = (sel) => {
    setLeftSelection(sel);
    // No self-compare: drop overlapping dealers from Compare with
    setRightSelection((right) => withoutOverlap(right, selectedDealerIds(sel)));
  };

  const handleRightDealers = (sel) => {
    setCompareCategories([]);
    setRightSelection(sel);
    // No self-compare: drop overlapping dealers from Dealer
    setLeftSelection((left) => withoutOverlap(left, selectedDealerIds(sel)));
  };

  const handleCategory = (cats) => {
    setCompareCategories(Array.isArray(cats) ? cats.filter(Boolean) : []);
  };

  const leftExcludeIds = selectedDealerIds(rightSelection);
  const rightExcludeIds = selectedDealerIds(leftSelection);
  const categoryActive = compareCategories.length > 0;
  const categoryPlaceholder =
    compareCategories.length === 1
      ? `Using All ${compareCategories[0]}`
      : compareCategories.length > 1
        ? `Using ${compareCategories.length} categories`
        : null;

  const dealersVsSummary = useMemo(
    () => compareVsSummary(leftSelection, effectiveRightSelection, selectableDealers),
    [leftSelection, effectiveRightSelection, selectableDealers]
  );

  return (
    <div className={`dealer-compare-page${compareLoading ? ' dealer-compare-page--busy' : ''}`}>
      <div
        className={`filters compare-page-filters dealer-compare-filters${compareLoading ? ' dealer-compare-filters--busy' : ''}`}
        aria-busy={compareLoading || undefined}
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
            placeholder={dealersLoading ? 'Loading…' : 'Select dealer(s)'}
            disabled={dealersLoading || compareLoading}
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
            allowAllDealers={false}
            placeholder={
              categoryPlaceholder
                ? categoryPlaceholder
                : dealersLoading
                  ? 'Loading…'
                  : 'Select dealer(s)'
            }
            disabled={dealersLoading || compareLoading || categoryActive}
          />
        </div>
        <CompareCategorySelect
          dealers={selectableDealers}
          value={compareCategories}
          onChange={handleCategory}
          disabled={dealersLoading || compareLoading}
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
            disabled={compareLoading}
          />
        </div>
        <div className="dealer-compare-date-filter">
          <span className="dealer-compare-side-title">Date range</span>
          <CalendarRangePicker value={dateRange} onChange={setDateRange} />
        </div>
        <div className="dealer-compare-dealers-summary">
          <span className="dealer-compare-side-title">Dealers</span>
          <div
            className="dealer-compare-vs-label"
            title={dealersVsSummary || undefined}
          >
            {dealersVsSummary || '—'}
          </div>
        </div>
      </div>

      <div className="content dealer-compare-content">
        <div className="dashboard-full-row">
          <DealerCompareChannelTable
            leftSelection={leftSelection}
            rightSelection={effectiveRightSelection}
            dealers={selectableDealers}
            from={from}
            to={to}
            pageTypeFilter="VDP"
            channelFilter={channelFilter}
            onLoadingChange={setCompareLoading}
          />
        </div>
      </div>
    </div>
  );
}
