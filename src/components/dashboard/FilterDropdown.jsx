'use client';

import { useEffect, useMemo, useState } from 'react';
import { useDropdown } from './useDropdown';
const DEFAULT_PAGE_SIZE = 10;

function isPinnedOption(option, defaultAll) {
  return (
    option.value === defaultAll ||
    option.label?.startsWith?.('All') ||
    option.value === 'Used + New' ||
    option.label === 'Used + New'
  );
}

/**
 * Filter chip dropdown — search + pagination when the list is long.
 *
 *  options: [{ value: 'All', label: 'All Types' }, ...]
 *  value:   currently selected value (string) or string[] when multi
 *  onChange(value): callback
 *  multi:   allow multiple selections (value is string[]; empty = All)
 */
export default function FilterDropdown({
  options,
  value,
  onChange,
  defaultAll = 'All',
  pageSize = DEFAULT_PAGE_SIZE,
  className = '',
  disabled = false,
  clearable = false,
  multi = false,
}) {
  const { open, toggle, close, ref } = useDropdown();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  const selectedList = useMemo(() => {
    if (!multi) return [];
    if (Array.isArray(value)) return value.filter((v) => v && v !== defaultAll);
    if (value && value !== defaultAll) return [value];
    return [];
  }, [multi, value, defaultAll]);

  const current = multi
    ? null
    : options.find((o) => o.value === value) || options[0];

  const isAll = multi
    ? selectedList.length === 0
    : current.value === defaultAll ||
      current.label?.startsWith?.('All') ||
      current.label === 'Used + New';

  const chipLabel = useMemo(() => {
    if (!multi) return current?.label ?? '';
    if (selectedList.length === 0) {
      const allOpt = options.find((o) => o.value === defaultAll);
      return allOpt?.label || 'All';
    }
    if (selectedList.length === 1) return selectedList[0];
    const allOpt = options.find((o) => o.value === defaultAll);
    const allLabel = allOpt?.label || '';
    if (/location/i.test(allLabel)) return `${selectedList.length} Locations`;
    if (/channel/i.test(allLabel)) return `${selectedList.length} Channels`;
    return `${selectedList.length} selected`;
  }, [multi, current, selectedList, options, defaultAll]);

  const { pinned, rest } = useMemo(() => {
    const pin = [];
    const tail = [];
    for (const o of options) {
      if (isPinnedOption(o, defaultAll)) pin.push(o);
      else tail.push(o);
    }
    return { pinned: pin, rest: tail };
  }, [options, defaultAll]);

  const filteredRest = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rest;
    return rest.filter(
      (o) =>
        String(o.label).toLowerCase().includes(q) ||
        String(o.value).toLowerCase().includes(q)
    );
  }, [rest, search]);

  const totalPages = Math.max(1, Math.ceil(filteredRest.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);

  const pageSlice = useMemo(
    () => filteredRest.slice(safePage * pageSize, safePage * pageSize + pageSize),
    [filteredRest, safePage, pageSize]
  );

  const showSearch = rest.length > pageSize;
  const showPager = filteredRest.length > pageSize;

  useEffect(() => {
    if (!open) {
      setSearch('');
      setPage(0);
    }
  }, [open]);

  useEffect(() => {
    if (!open || multi || !value) return;
    const selected = options.find((o) => o.value === value);
    if (!selected || isPinnedOption(selected, defaultAll)) return;
    const idx = filteredRest.findIndex((o) => o.value === value);
    if (idx >= 0) setPage(Math.floor(idx / pageSize));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps -- jump to selected page on open only

  useEffect(() => {
    setPage(0);
  }, [search]);

  useEffect(() => {
    if (page > totalPages - 1) setPage(Math.max(0, totalPages - 1));
  }, [page, totalPages]);

  const handleToggle = () => {
    if (disabled) return;
    toggle();
  };

  const handleSelect = (nextValue) => {
    if (multi) {
      if (nextValue === defaultAll) {
        onChange([]);
        return;
      }
      const exists = selectedList.includes(nextValue);
      onChange(
        exists
          ? selectedList.filter((v) => v !== nextValue)
          : [...selectedList, nextValue]
      );
      return;
    }
    onChange(nextValue);
    close();
  };

  const isOptionSelected = (optionValue) => {
    if (multi) {
      if (optionValue === defaultAll) return selectedList.length === 0;
      return selectedList.includes(optionValue);
    }
    return optionValue === value;
  };

  const showClear = clearable && !isAll && !disabled;

  const handleClear = (e) => {
    e.stopPropagation();
    onChange(multi ? [] : defaultAll);
    close();
  };

  return (
    <div ref={ref} style={{ position: 'relative' }} className={className}>
      <div
        className={`fc ${!isAll ? 'on' : ''} ${disabled ? 'fc--disabled' : ''}`}
        onClick={handleToggle}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-multiselectable={multi || undefined}
        title={
          disabled
            ? 'Coming soon'
            : multi && selectedList.length > 1
              ? selectedList.join(', ')
              : undefined
        }
      >
        <span className="fc-label">{chipLabel}</span>
        {showClear && (
          <button
            type="button"
            className="fc-clear"
            onClick={handleClear}
            aria-label="Clear filter"
            title="Clear filter"
          >
            ×
          </button>
        )}
        <span className="arr">▾</span>
      </div>
      {open && !disabled && (
        <div className="dm dm--paged animate-fade-in" role="listbox">
          {showSearch && (
            <div className="dm-search-wrap">
              <input
                type="search"
                className="dm-search"
                placeholder="Search…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                autoFocus
                aria-label="Search filter options"
              />
            </div>
          )}

          <div className="dm-list">
            {pinned.map((o) => {
              const sel = isOptionSelected(o.value);
              return (
                <div
                  key={o.value}
                  role="option"
                  aria-selected={sel}
                  className={`dm-i ${sel ? 'sel' : ''}`}
                  onClick={() => handleSelect(o.value)}
                >
                  <div className="dm-chk">{sel ? '✓' : ''}</div>
                  {o.label}
                </div>
              );
            })}

            {pageSlice.length === 0 && pinned.length === 0 && (
              <div className="dm-empty">No matches</div>
            )}

            {pageSlice.length === 0 && pinned.length > 0 && search.trim() && (
              <div className="dm-empty">No matches</div>
            )}

            {pageSlice.map((o) => {
              const sel = isOptionSelected(o.value);
              return (
                <div
                  key={o.value}
                  role="option"
                  aria-selected={sel}
                  className={`dm-i ${sel ? 'sel' : ''}`}
                  onClick={() => handleSelect(o.value)}
                >
                  <div className="dm-chk">{sel ? '✓' : ''}</div>
                  {o.label}
                </div>
              );
            })}
          </div>

          {showPager && (
            <div className="dm-pager">
              <button
                type="button"
                className="dm-pager-btn"
                disabled={safePage <= 0}
                onClick={(e) => {
                  e.stopPropagation();
                  setPage((p) => Math.max(0, p - 1));
                }}
                aria-label="Previous page"
              >
                ‹
              </button>
              <span className="dm-pager-info">
                {safePage + 1} / {totalPages}
              </span>
              <button
                type="button"
                className="dm-pager-btn"
                disabled={safePage >= totalPages - 1}
                onClick={(e) => {
                  e.stopPropagation();
                  setPage((p) => Math.min(totalPages - 1, p + 1));
                }}
                aria-label="Next page"
              >
                ›
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
