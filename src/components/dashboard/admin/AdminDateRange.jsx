'use client';

function toDateInputValue(iso) {
  if (!iso) return '';
  return String(iso).slice(0, 10);
}

export default function AdminDateRange({
  from,
  to,
  onFromChange,
  onToChange,
  onApplyLastDays,
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
        <button type="button" className="admin-date-preset" onClick={() => onApplyLastDays(10)}>
          10d
        </button>
        <button type="button" className="admin-date-preset" onClick={() => onApplyLastDays(30)}>
          30d
        </button>
      </div>
    </div>
  );
}
