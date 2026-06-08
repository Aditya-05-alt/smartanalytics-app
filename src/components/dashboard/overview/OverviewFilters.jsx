'use client';

import FilterDropdown from '../FilterDropdown';
import CalendarRangePicker from '../CalendarRangePicker';
import { useClient } from '../ClientContext';
import { useOverview } from './OverviewDataContext';

const CONDITION_OPTIONS = ['All', 'Used + New', 'Used', 'New'];

function toOpts(values, allLabel) {
  return (values || ['All']).map((v) => ({
    value: v,
    label: v === 'All' ? allLabel : v,
  }));
}

export default function OverviewFilters() {
  const { config } = useClient();
  const {
    dateRange,
    setDateRange,
    tab,
    vdpFilters,
    setVdpFilter,
    vdpFilterOptions,
  } = useOverview();

  const showVdpFilters = tab === 'vdp';

  const typeValues = vdpFilterOptions.types?.length > 1
    ? vdpFilterOptions.types
    : ['All', ...(config.types || [])];

  const conditionOpts = CONDITION_OPTIONS.map((v) => ({
    value: v,
    label: v === 'All' ? 'All Conditions' : v,
  }));

  return (
    <div className="filters">
      {showVdpFilters && (
        <>
          <span className="f-label">Filter</span>
          <FilterDropdown
            options={conditionOpts}
            value={vdpFilters.condition}
            onChange={(v) => setVdpFilter('condition', v)}
          />
          <FilterDropdown
            options={toOpts(vdpFilterOptions.years, 'All Years')}
            value={vdpFilters.year}
            onChange={(v) => setVdpFilter('year', v)}
          />
          <FilterDropdown
            options={toOpts(vdpFilterOptions.makes, 'All Makes')}
            value={vdpFilters.make}
            onChange={(v) => setVdpFilter('make', v)}
          />
          <FilterDropdown
            options={toOpts(vdpFilterOptions.models, 'All Models')}
            value={vdpFilters.model}
            onChange={(v) => setVdpFilter('model', v)}
          />
          <FilterDropdown
            options={toOpts(typeValues, `All ${config.typeH || 'Types'}`)}
            value={vdpFilters.type}
            onChange={(v) => setVdpFilter('type', v)}
          />
          {config.showLoc !== false && (
            <FilterDropdown
              options={toOpts(vdpFilterOptions.locations, 'All Locations')}
              value={vdpFilters.location}
              onChange={(v) => setVdpFilter('location', v)}
            />
          )}
        </>
      )}
      <div className="f-right">
        <CalendarRangePicker value={dateRange} onChange={setDateRange} />
      </div>
    </div>
  );
}
