'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import AllDealersFocusedTable from '@/components/dashboard/all-dealers/AllDealersFocusedTable';
import AllDealerExportButton from '@/components/dashboard/overview/AllDealerExportButton';
import {
  AllDealerMatrixProvider,
  useAllDealerMatrix,
} from '@/components/dashboard/overview/AllDealerMatrixContext';
import {
  OverviewProvider,
  useOverview,
} from '@/components/dashboard/overview/OverviewDataContext';
import FilterDropdown from '@/components/dashboard/FilterDropdown';
import CalendarRangePicker from '@/components/dashboard/CalendarRangePicker';
import { useClient } from '@/components/dashboard/ClientContext';
import { CompareSeg } from '@/components/campaigns/CampaignUi';

const COMPARE_MODES = [
  { value: 'pop', label: 'PoP' },
  { value: 'mom', label: 'MoM' },
];

function AllDealersExternalFilters({
  dealerOptions,
  selectedDealers,
  setSelectedDealers,
  compareMode,
  onCompareModeChange,
}) {
  const { dateRange, setDateRange } = useOverview();
  const { snapshot } = useAllDealerMatrix();

  return (
    <div className="filters all-dealer-filters">
      <div className="all-dealer-filters-left">
        <FilterDropdown
          multi
          clearable
          options={dealerOptions}
          value={selectedDealers}
          onChange={setSelectedDealers}
        />
        {snapshot?.ready ? <AllDealerExportButton /> : null}
      </div>
      <div className="f-right all-dealer-filters-right">
        <CompareSeg
          value={compareMode}
          options={COMPARE_MODES}
          onChange={onCompareModeChange}
        />
        <span className="f-label">Date range</span>
        <CalendarRangePicker value={dateRange} onChange={setDateRange} />
      </div>
    </div>
  );
}

function AllDealersExternalBody() {
  const { dealers, isAllDealer, pickClient, allDealerClient, loading } =
    useClient();
  const { tab, setTab } = useOverview();

  const [selectedDealers, setSelectedDealers] = useState([]);
  const [compareMode, setCompareMode] = useState(null);

  const toggleCompareMode = useCallback((next) => {
    setCompareMode((prev) => (prev === next ? null : next));
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!isAllDealer) pickClient(allDealerClient);
  }, [loading, isAllDealer, pickClient, allDealerClient]);

  useEffect(() => {
    if (tab !== 'vdp') setTab('vdp');
  }, [tab, setTab]);

  const dealerOptions = useMemo(
    () => [
      { value: 'All', label: 'All Dealers' },
      ...(dealers || [])
        .filter((d) => d?.name)
        .map((d) => ({ value: d.name, label: d.name })),
    ],
    [dealers]
  );

  return (
    <>
      <AllDealersExternalFilters
        dealerOptions={dealerOptions}
        selectedDealers={selectedDealers}
        setSelectedDealers={setSelectedDealers}
        compareMode={compareMode}
        onCompareModeChange={toggleCompareMode}
      />
      <AllDealersFocusedTable
        selectedDealerNames={selectedDealers}
        compareMode={compareMode}
      />
    </>
  );
}

export default function AllDealersExternalView() {
  return (
    <OverviewProvider>
      <AllDealerMatrixProvider>
        <AllDealersExternalBody />
      </AllDealerMatrixProvider>
    </OverviewProvider>
  );
}
