'use client';

import { useState } from 'react';
import FilterDropdown from '../FilterDropdown';
import CalendarRangePicker from '../CalendarRangePicker';
import { useClient } from '../ClientContext';
import { useOverview } from './OverviewDataContext';

export default function OverviewFilters() {
  const { config } = useClient();
  const { dateRange, setDateRange, tab } = useOverview();
  const showVdpFilters = tab === 'vdp';
  const filtersDisabled = true;

  const [typeV, setTypeV]   = useState('All');
  const [classV, setClassV] = useState('All');
  const [condV, setCondV]   = useState('Used + New');
  const [makeV, setMakeV]   = useState('All');
  const [locV, setLocV]     = useState('All');
  const [chanV, setChanV]   = useState('All');
  const [radV, setRadV]     = useState('All');

  const typeOpts = [
    { value: 'All', label: 'All Types' },
    ...config.types.map((t) => ({ value: t, label: t })),
  ];
  const classOpts = [
    { value: 'All',     label: 'All Classes' },
    { value: 'Class A', label: 'Class A' },
    { value: 'Class B', label: 'Class B' },
    { value: 'Class C', label: 'Class C' },
  ];
  const condOpts = [
    { value: 'Used + New', label: 'Used + New' },
    { value: 'Used',       label: 'Used Only'  },
    { value: 'New',        label: 'New Only'   },
  ];
  const makeOpts = [
    { value: 'All', label: 'All Makes' },
    ...config.makes.map((m) => ({ value: m, label: m })),
  ];
  const locOpts = [
    { value: 'All',         label: 'All Locations' },
    { value: 'Dallas',      label: 'Dallas — Main' },
    { value: 'Fort Worth',  label: 'Fort Worth' },
    { value: 'Plano',       label: 'Plano' },
  ];
  const chanOpts = [
    { value: 'All',          label: 'All Channels'    },
    { value: 'Organic',      label: 'Organic Search'  },
    { value: 'Paid Search',  label: 'Paid Search'     },
    { value: 'Direct',       label: 'Direct'          },
    { value: 'Paid Social',  label: 'Paid Social'     },
  ];
  const radOpts = [
    { value: 'All',         label: 'All Distances' },
    { value: '15',          label: 'Within 15 mi'  },
    { value: '15-40',       label: '15–40 mi'      },
    { value: '40-100',      label: '40–100 mi'     },
    { value: 'out',         label: 'Out of area'   },
  ];

  return (
    <div className="filters">
      {showVdpFilters && (
        <>
          <span className="f-label">Filter</span>
          <FilterDropdown
            options={typeOpts}
            value={typeV}
            onChange={setTypeV}
            disabled={filtersDisabled}
          />
          {config.showClass && (
            <FilterDropdown
              options={classOpts}
              value={classV}
              onChange={setClassV}
              disabled={filtersDisabled}
            />
          )}
          <FilterDropdown
            options={condOpts}
            value={condV}
            onChange={setCondV}
            defaultAll="Used + New"
            disabled={filtersDisabled}
          />
          <FilterDropdown
            options={makeOpts}
            value={makeV}
            onChange={setMakeV}
            disabled={filtersDisabled}
          />
          {config.showLoc && (
            <FilterDropdown
              options={locOpts}
              value={locV}
              onChange={setLocV}
              disabled={filtersDisabled}
            />
          )}
          <FilterDropdown
            options={chanOpts}
            value={chanV}
            onChange={setChanV}
            disabled={filtersDisabled}
          />
          <FilterDropdown
            options={radOpts}
            value={radV}
            onChange={setRadV}
            disabled={filtersDisabled}
          />
          {filtersDisabled && (
            <span className="f-wip-msg" role="status">
              Disabled — under progress
            </span>
          )}
        </>
      )}
      <div className="f-right">
        <CalendarRangePicker value={dateRange} onChange={setDateRange} />
      </div>
    </div>
  );
}
