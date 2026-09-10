'use client';

import { useEffect, useMemo, useState } from 'react';
import CalendarRangePicker, {
  resolveRangePickerValue,
} from '@/components/dashboard/CalendarRangePicker';
import FilterDropdown from '@/components/dashboard/FilterDropdown';
import { useClient } from '@/components/dashboard/ClientContext';
import DealerSelect from '@/components/dashboard/compare/DealerSelect';
import CompareCategorySelect from '@/components/dashboard/compare/CompareCategorySelect';
import DealerCompareChannelTable from '@/components/dashboard/compare/DealerCompareChannelTable';
import { isAllDealerClient } from '@/lib/dashboard/allDealers';
import {
  EMPTY_COMPARE_SELECTION,
  createCategorySelection,
  selectionFromDealer,
} from '@/lib/compare/compareSelection';
import { VDP_CHANNEL_FILTER_OPTIONS } from '@/lib/vdp/vdpFilterParams';
import {
  readStoredOverviewDateRange,
  writeStoredOverviewDateRange,
} from '@/lib/dashboard/dashboardPrefs';

/** Resolve picker value → ISO from/to (same presets as Overview). */
function resolveRange(value) {
  const resolved = resolveRangePickerValue(value);
  if (resolved?.start && resolved?.end) {
    return {
      from: String(resolved.start).slice(0, 10),
      to: String(resolved.end).slice(0, 10),
    };
  }
  // Fallback: current month MTD
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  return { from: ymd(start), to: ymd(today) };
}

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

export default function ComparePage() {
  const {
    client,
    allDealers,
    loading: dealersLoading,
    canUseAllDealers,
  } = useClient();
  const [dateRange, setDateRange] = useState(
    () => readStoredOverviewDateRange() || 'current_month'
  );
  const [leftSelection, setLeftSelection] = useState(EMPTY_COMPARE_SELECTION);
  const [rightSelection, setRightSelection] = useState(EMPTY_COMPARE_SELECTION);
  /** Single category for Compare with (null = use dealer picker). */
  const [compareCategory, setCompareCategory] = useState(null);
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
    setLeftSelection((sel) => pruneDealerSelection(sel, valid));
    setRightSelection((sel) => pruneDealerSelection(sel, valid));
  }, [selectableDealers]);

  useEffect(() => {
    writeStoredOverviewDateRange(dateRange);
  }, [dateRange]);

  const { from, to } = resolveRange(dateRange);

  // Category overrides Compare-with dealers when set.
  const effectiveRightSelection = useMemo(() => {
    if (compareCategory) return createCategorySelection(compareCategory);
    return rightSelection;
  }, [compareCategory, rightSelection]);

  const handleRightDealers = (sel) => {
    setCompareCategory(null);
    setRightSelection(sel);
  };

  const handleCategory = (cat) => {
    setCompareCategory(cat);
  };

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
            onChange={setLeftSelection}
            allowAllDealers={canUseAllDealers}
            placeholder={dealersLoading ? 'Loading…' : 'Select dealer(s)'}
            disabled={dealersLoading || compareLoading}
          />
        </div>
        <div className="dealer-compare-side">
          <span className="dealer-compare-side-title">Compare with</span>
          <DealerSelect
            label={null}
            dealers={selectableDealers}
            value={compareCategory ? EMPTY_COMPARE_SELECTION : rightSelection}
            onChange={handleRightDealers}
            allowAllDealers={canUseAllDealers}
            placeholder={
              compareCategory
                ? `Using All ${compareCategory}`
                : dealersLoading
                  ? 'Loading…'
                  : 'Select dealer(s)'
            }
            disabled={dealersLoading || compareLoading || Boolean(compareCategory)}
          />
        </div>
        <CompareCategorySelect
          dealers={selectableDealers}
          value={compareCategory}
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
