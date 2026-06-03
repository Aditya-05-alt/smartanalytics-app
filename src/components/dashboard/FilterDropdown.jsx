'use client';

import { useDropdown } from './useDropdown';

/**
 * A single filter chip with its dropdown menu.
 *
 *  options: [{ value: 'All', label: 'All Types' }, ...]
 *  value:   currently selected value
 *  onChange(value): callback
 *  isAllOption(value): override for what counts as the "neutral" option
 */
export default function FilterDropdown({
  options,
  value,
  onChange,
  defaultAll = 'All',
  className = '',
  disabled = false,
}) {
  const { open, toggle, close, ref } = useDropdown();

  const current = options.find((o) => o.value === value) || options[0];
  const isAll = current.value === defaultAll || current.label?.startsWith?.('All') || current.label === 'Used + New';

  const handleToggle = () => {
    if (disabled) return;
    toggle();
  };

  return (
    <div ref={ref} style={{ position: 'relative' }} className={className}>
      <div
        className={`fc ${!isAll ? 'on' : ''} ${disabled ? 'fc--disabled' : ''}`}
        onClick={handleToggle}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        title={disabled ? 'Coming soon' : undefined}
      >
        <span>{current.label}</span>
        <span className="arr">▾</span>
      </div>
      {open && !disabled && (
        <div className="dm animate-fade-in">
          {options.map((o) => {
            const sel = o.value === value;
            return (
              <div
                key={o.value}
                className={`dm-i ${sel ? 'sel' : ''}`}
                onClick={() => {
                  onChange(o.value);
                  close();
                }}
              >
                <div className="dm-chk">{sel ? '✓' : ''}</div>
                {o.label}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
