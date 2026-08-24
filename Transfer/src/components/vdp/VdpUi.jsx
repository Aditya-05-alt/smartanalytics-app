'use client';

export function Seg({ value, options, onChange }) {
  return (
    <div className="vdp-seg">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={value === opt.value ? 'active' : ''}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function Kpi({ label, value, delta, sub, isPP }) {
  const cls =
    delta == null
      ? 'flat'
      : delta > 5
        ? 'up'
        : delta < -5
          ? 'down'
          : 'flat';
  return (
    <div className="vdp-kpi">
      <div className="vdp-kpi-lbl">{label}</div>
      <div className="vdp-kpi-val mono">{value}</div>
      {delta == null ? (
        <div className="vdp-delta flat">{sub}</div>
      ) : (
        <div className={`vdp-delta ${cls}`}>
          {isPP
            ? `${delta >= 0 ? '+' : ''}${delta.toFixed(1)} pts`
            : `${delta >= 0 ? '+' : ''}${Number(delta).toFixed(1)}%`}{' '}
          {sub}
        </div>
      )}
    </div>
  );
}

export function Card({ title, sub, children, style, className }) {
  return (
    <div className={`vdp-card${className ? ` ${className}` : ''}`} style={style}>
      {title && <h3>{title}</h3>}
      {sub && <div className="vdp-cardsub">{sub}</div>}
      {children}
    </div>
  );
}

export function Toolbar({ children }) {
  return <div className="vdp-toolbar">{children}</div>;
}

export function ToolbarGroup({ label, children }) {
  return (
    <div className="vdp-grp">
      {label && <label>{label}</label>}
      {children}
    </div>
  );
}
