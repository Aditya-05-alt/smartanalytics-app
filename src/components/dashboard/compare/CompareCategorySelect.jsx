'use client';

import { useMemo } from 'react';
import FilterDropdown from '@/components/dashboard/FilterDropdown';
import { categoriesPresentInDealers } from '@/lib/compare/compareSelection';

/**
 * Multi Category dropdown for Compare (All RV, All Powersports, …).
 * value: string[] of categories (empty = All / none selected)
 */
export default function CompareCategorySelect({
  dealers = [],
  value = [],
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

  const selected = useMemo(() => {
    if (Array.isArray(value)) return value.filter(Boolean);
    if (value) return [value];
    return [];
  }, [value]);

  return (
    <div className="dealer-compare-field dealer-compare-category-bar">
      {label ? (
        <span className="dealer-compare-side-title">{label}</span>
      ) : null}
      <FilterDropdown
        multi
        clearable
        disabled={disabled || categories.length === 0}
        options={options}
        value={selected}
        onChange={(next) => {
          const list = Array.isArray(next)
            ? next.filter((v) => v && v !== 'All')
            : next && next !== 'All'
              ? [next]
              : [];
          onChange?.(list);
        }}
      />
    </div>
  );
}
