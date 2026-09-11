'use client';

import { useEffect, useMemo, useState } from 'react';
import { useDropdown } from '@/components/dashboard/useDropdown';
import { CATEGORIES } from '@/lib/data/categories';
import {
  EMPTY_COMPARE_SELECTION,
  createAllSelection,
  createDealerSelection,
  resolveSelectionDealers,
  selectionLabel,
} from '@/lib/compare/compareSelection';

/**
 * Multi-select dealer picker for Compare.
 * Individual dealers only (All Dealers disabled).
 * Dealers in excludeDealerIds are hidden (no self-compare).
 */
export default function DealerSelect({
  dealers = [],
  value = EMPTY_COMPARE_SELECTION,
  onChange,
  excludeDealerIds = [],
  allowAllDealers = true,
  placeholder = 'Select dealer(s)',
  label,
  disabled = false,
}) {
  const { open, toggle, close, ref } = useDropdown();
  const [query, setQuery] = useState('');

  const excludeSet = useMemo(
    () => new Set((excludeDealerIds || []).map(String)),
    [excludeDealerIds]
  );

  const listItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (dealers || []).filter((d) => {
      if (!d?.id || excludeSet.has(String(d.id))) return false;
      if (!q) return true;
      return String(d.name || '')
        .toLowerCase()
        .includes(q);
    });
  }, [dealers, excludeSet, query]);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const isAll = value?.type === 'all';
  const isDealerMode = value?.type === 'dealers' || value?.type === 'all';
  const selectedDealerIds = useMemo(() => {
    if (value?.type !== 'dealers') return new Set();
    return new Set((value.dealerIds || []).map(String));
  }, [value]);

  const chipText = isDealerMode
    ? selectionLabel(value, dealers) || placeholder
    : placeholder;

  const resolvedCount =
    value?.type === 'dealers' || value?.type === 'all'
      ? resolveSelectionDealers(value, dealers).length
      : 0;

  const toggleDealer = (dealerId) => {
    const id = String(dealerId);
    if (value?.type === 'dealers') {
      const next = new Set((value.dealerIds || []).map(String));
      if (next.has(id)) next.delete(id);
      else next.add(id);
      onChange?.(
        next.size ? createDealerSelection([...next]) : { ...EMPTY_COMPARE_SELECTION }
      );
      return;
    }
    // Overrides All Dealers / Category
    onChange?.(createDealerSelection([id]));
  };

  const pickAll = () => {
    if (isAll) onChange?.({ ...EMPTY_COMPARE_SELECTION });
    else onChange?.(createAllSelection());
  };

  const handleClear = (e) => {
    e.stopPropagation();
    onChange?.({ ...EMPTY_COMPARE_SELECTION });
    close();
  };

  return (
    <div className="dealer-compare-field">
      {label && <span className="dealer-compare-field-label">{label}</span>}
      <div ref={ref} style={{ position: 'relative' }}>
        <div
          className={`client-pick dealer-compare-pick ${disabled ? 'dealer-compare-pick--disabled' : ''} ${isDealerMode ? 'on' : ''}`}
          onClick={() => {
            if (!disabled) toggle();
          }}
          role="button"
          tabIndex={disabled ? -1 : 0}
          aria-disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-multiselectable
          title={
            value?.type === 'dealers' && value.dealerIds?.length > 1
              ? resolveSelectionDealers(value, dealers)
                  .map((d) => d.name)
                  .join(', ')
              : undefined
          }
        >
          <div
            className="cp-dot"
            style={{
              background: isAll
                ? 'var(--t3)'
                : CATEGORIES.rv?.color || 'var(--acc, #4EE09C)',
            }}
            aria-hidden
          />
          <span className="cp-name">{chipText}</span>
          {isDealerMode && (
            <button
              type="button"
              className="fc-clear dealer-compare-clear"
              onClick={handleClear}
              aria-label="Clear selection"
              title="Clear"
            >
              ×
            </button>
          )}
          <span className="cp-arr">▼</span>
        </div>
        {open && !disabled && (
          <div className="client-dropdown dealer-compare-dropdown animate-fade-in" role="listbox">
            <div className="cd-search-wrap">
              <input
                type="search"
                className="cd-search"
                placeholder="Search dealers…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
                aria-label="Search dealers"
              />
            </div>
            <div className="cd-list">
              {allowAllDealers && !query.trim() && (
                <div
                  className={`cd-item ${isAll ? 'sel' : ''}`}
                  role="option"
                  aria-selected={isAll}
                  onClick={pickAll}
                >
                  <span className="dealer-compare-check" aria-hidden>
                    {isAll ? '✓' : ''}
                  </span>
                  <span className="cd-name">All Dealers</span>
                  <span className="cd-badge dealer-compare-meta">
                    {dealers.filter((d) => d?.ga4CustomerId).length}
                  </span>
                </div>
              )}

              <div className="dealer-compare-section">
                Dealers
                {value?.type === 'dealers' && selectedDealerIds.size > 0
                  ? ` · ${selectedDealerIds.size} selected`
                  : ''}
              </div>

              {listItems.length === 0 && (
                <div className="cd-empty">
                  {query
                    ? `No dealers match “${query}”.`
                    : 'No dealers available.'}
                </div>
              )}
              {listItems.map((c) => {
                const selected = selectedDealerIds.has(String(c.id));
                const dotColor =
                  CATEGORIES[c.category]?.color || 'var(--acc, #4EE09C)';
                return (
                  <div
                    key={c.id}
                    className={`cd-item ${selected ? 'sel' : ''}`}
                    role="option"
                    aria-selected={selected}
                    onClick={() => toggleDealer(c.id)}
                  >
                    <span className="dealer-compare-check" aria-hidden>
                      {selected ? '✓' : ''}
                    </span>
                    <div className="cd-dot" style={{ background: dotColor }} />
                    <span className="cd-name">{c.name}</span>
                    {c.dealerCategory && (
                      <span className="cd-badge dealer-compare-meta">
                        {c.dealerCategory}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            {isDealerMode && (
              <div className="dealer-compare-dropdown-foot">
                {resolvedCount} dealer{resolvedCount === 1 ? '' : 's'} in selection
                <button type="button" className="dealer-compare-done" onClick={close}>
                  Done
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
