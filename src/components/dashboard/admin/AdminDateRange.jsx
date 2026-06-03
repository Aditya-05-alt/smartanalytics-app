'use client';

function toDateInputValue(iso) {
  if (!iso) return '';
  return String(iso).slice(0, 10);
}

const DEFAULT_PRESETS = [10, 30];

export default function AdminDateRange({
  from,
  to,
  onFromChange,
  onToChange,
  onApplyLastDays,
  presets = DEFAULT_PRESETS,
}) {
  return (
    <div className="admin-date-range">
      <label className="admin-date-field">
        <span className="admin-date-label">From</span>
        <input
          type="date"
          className="admin-date-input"
          value={toDateInputValue(from)}
          max={toDateInputValue(to)}
          onChange={(e) => onFromChange(e.target.value)}
        />
      </label>
      <label className="admin-date-field">
        <span className="admin-date-label">To</span>
        <input
          type="date"
          className="admin-date-input"
          value={toDateInputValue(to)}
          min={toDateInputValue(from)}
          onChange={(e) => onToChange(e.target.value)}
        />
      </label>
      <div className="admin-date-presets" role="group" aria-label="Quick ranges">
        {presets.map((days) => (
          <button
            key={days}
            type="button"
            className="admin-date-preset"
            onClick={() => onApplyLastDays(days)}
          >
            {days}d
          </button>
        ))}
      </div>
    </div>
  );
}
