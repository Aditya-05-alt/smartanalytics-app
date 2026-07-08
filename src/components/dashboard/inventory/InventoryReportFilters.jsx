'use client';

import FilterDropdown from '@/components/dashboard/FilterDropdown';
import InventoryDatePicker from './InventoryDatePicker';
import {
  INVENTORY_CONDITION_OPTIONS,
  inventoryFiltersActive,
  toFilterOpts,
} from '@/lib/inventory/inventoryReportFilters';
import { useInventoryReport } from './InventoryReportContext';

export default function InventoryReportFilters() {
  const {
    reportDate,
    setReportDate,
    filters,
    setFilter,
    clearFilters,
    filterOptions,
    showLocationFilter,
    typeHeader,
  } = useInventoryReport();

  const hasActiveFilters = inventoryFiltersActive(filters);

  return (
    <div className="filters">
      <span className="f-label">Filter</span>
      {hasActiveFilters && (
        <button
          type="button"
          className="filter-clear-all"
          onClick={clearFilters}
          aria-label="Clear all filters"
          title="Clear all filters"
        >
          ×
        </button>
      )}
      <FilterDropdown
        clearable
        options={INVENTORY_CONDITION_OPTIONS}
        value={filters.condition}
        onChange={(v) => setFilter('condition', v)}
      />
      <FilterDropdown
        clearable
        options={toFilterOpts(filterOptions.years, 'All Years')}
        value={filters.year}
        onChange={(v) => setFilter('year', v)}
      />
      <FilterDropdown
        clearable
        options={toFilterOpts(filterOptions.makes, 'All Makes')}
        value={filters.make}
        onChange={(v) => setFilter('make', v)}
      />
      <FilterDropdown
        clearable
        options={toFilterOpts(filterOptions.models, 'All Models')}
        value={filters.model}
        onChange={(v) => setFilter('model', v)}
      />
      <FilterDropdown
        clearable
        options={toFilterOpts(filterOptions.types, `All ${typeHeader}`)}
        value={filters.type}
        onChange={(v) => setFilter('type', v)}
      />
      {showLocationFilter && (
        <FilterDropdown
          clearable
          options={toFilterOpts(filterOptions.locations, 'All Locations')}
          value={filters.location}
          onChange={(v) => setFilter('location', v)}
        />
      )}
      <div className="f-right">
        <span className="f-label">Date</span>
        <InventoryDatePicker value={reportDate} onChange={setReportDate} />
      </div>
    </div>
  );
}
