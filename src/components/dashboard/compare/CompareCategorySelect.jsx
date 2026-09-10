'use client';

import { useMemo } from 'react';
import FilterDropdown from '@/components/dashboard/FilterDropdown';
import { categoriesPresentInDealers } from '@/lib/compare/compareSelection';

/**
 * Single Category dropdown for Compare (All RV, All Powersports, …).
 * value: category string or null/All
 */
export default function CompareCategorySelect({
  dealers = [],
  value = null,
  onChange,
  disabled = false,
  label = 'Category',
}) {
  const categories = useMemo(
    () => categoriesPresentInDealers(dealers),
    [dealers]
  );

  const options = useMemo(
    () => [
      { value: 'All', label: 'All Categories' },
      ...categories.map((cat) => {
        const count = dealers.filter(
          (d) => d.dealerCategory === cat && d.ga4CustomerId
        ).length;
        return {
          value: cat,
          label: count > 0 ? `All ${cat} (${count})` : `All ${cat}`,
        };
      }),
    ],
    [categories, dealers]
  );

  const selected = value || 'All';

  return (
    <div className="dealer-compare-field dealer-compare-category-bar">
      {label ? (
        <span className="dealer-compare-side-title">{label}</span>
      ) : null}
      <FilterDropdown
        clearable
        disabled={disabled || categories.length === 0}
        options={options}
        value={selected}
        onChange={(next) => {
          if (!next || next === 'All') onChange?.(null);
          else onChange?.(next);
        }}
      />
    </div>
  );
}
