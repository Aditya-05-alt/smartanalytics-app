'use client';

import { useEffect, useMemo, useState } from 'react';
import { useDropdown } from '@/components/dashboard/useDropdown';
import { toCalendarISO } from '@/lib/ga4/dateRange';

function formatDisplayDate(iso) {
  if (!iso) return 'Select date';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function daysAgoISO(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toCalendarISO(d);
}

export default function InventoryDatePicker({ value, onChange, max }) {
  const { open, toggle, close, ref } = useDropdown();
  const today = useMemo(() => toCalendarISO(new Date()), []);
  const maxDate = max ?? today;
  const yesterday = useMemo(() => daysAgoISO(1), []);

  const [draft, setDraft] = useState(value || today);

  useEffect(() => {
    if (!open) return;
    setDraft(value || today);
  }, [open, value, today]);

  const display = formatDisplayDate(value);

  const presets = useMemo(() => [
    { id: 'today', label: 'Today', date: today },
    { id: 'yesterday', label: 'Yesterday', date: yesterday },
  ], [today, yesterday]);

  function applyDate(iso) {
    const date = String(iso || '').slice(0, 10);
    if (!date || date > maxDate) return;
    onChange(date);
    close();
  }

  return (
    <div ref={ref} className="dr-wrap inventory-date-picker">
      <div
        className="dr-trigger"
        onClick={toggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') toggle();
        }}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="dr-ico" aria-hidden>📅</span>
        <span className="dr-label">{display}</span>
        <span className="dr-arr">▾</span>
      </div>

      {open && (
        <div className="dr-menu dr-menu-wide inventory-date-menu" role="menu">
          {presets.map((p) => {
            const selected = value === p.date;
            return (
              <div
                key={p.id}
                className={`dr-item ${selected ? 'sel' : ''}`}
                role="menuitem"
                onClick={() => applyDate(p.date)}
              >
                <div className="dr-chk">{selected ? '✓' : ''}</div>
                <span>{p.label}</span>
              </div>
            );
          })}

          <div className="dr-custom inventory-date-custom">
            <label className="dr-field">
              <span>Select date</span>
              <input
                type="date"
                value={draft}
                max={maxDate}
                onChange={(e) => setDraft(e.target.value)}
                aria-label="Inventory report date"
              />
            </label>

            <div className="dr-custom-actions">
              <button type="button" className="dr-btn dr-btn-ghost" onClick={close}>
                Cancel
              </button>
              <button
                type="button"
                className="dr-btn dr-btn-primary"
                onClick={() => applyDate(draft)}
                disabled={!draft}
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
