'use client';

import { createContext, useContext } from 'react';
import { fmt, notesFor } from '@/lib/wheelerPump/calc';
import styles from './WheelerPump.module.css';

/** Class names from WheelerPump.module.css: cx('card', cond && 'chart') */
export const cx = (...names) => names.filter(Boolean).map((name) => styles[name] || name).join(' ');

export const DashCtx = createContext(null);
export function useDash() {
  const dash = useContext(DashCtx);
  if (!dash) throw new Error('useDash outside the Wheeler Pump dashboard');
  return dash;
}

export function DeltaChip({ now, before, goodWhenUp, isPct = false }) {
  if (before == null || now == null || !Number.isFinite(now) || !Number.isFinite(before)) {
    return <span className={cx('chip')}>no prior</span>;
  }
  const d = now - before;
  if (Math.abs(d) < (isPct ? 0.005 : 0.5)) return <span className={cx('chip')}>no change</span>;
  const good = goodWhenUp ? d > 0 : d < 0;
  return (
    <span className={cx('chip', good ? 'good' : 'bad')}>
      {(d > 0 ? '▲ ' : '▼ ') + (isPct ? `${Math.abs(d * 100).toFixed(0)} pts` : fmt(Math.abs(d)))}
    </span>
  );
}

export const NoPrior = () => <span className={cx('chip')}>no prior</span>;

export function NoteButton({ ctx, label }) {
  const { data, openNotes } = useDash();
  const n = notesFor(data.notes, ctx).length;
  return (
    <button
      type="button"
      className={cx('notebtn', n && 'has')}
      title={n ? 'View notes' : 'Add a note'}
      onClick={() => openNotes(ctx, label)}
    >
      {n ? `${n}${n === 1 ? ' note' : ' notes'}` : '+ note'}
    </button>
  );
}

export function Card({ title, sub, action, children, className, style }) {
  return (
    <section className={`${cx('card')} ${className ?? ''}`} style={style}>
      {(title || action) && (
        <div className={cx('cardhead')}>
          <div>
            {title && <h2>{title}</h2>}
            {sub && <p className={cx('sub')}>{sub}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Bar({ value, max, color }) {
  return (
    <div className={cx('bar')}>
      <i style={{ width: `${(value / Math.max(1, max)) * 100}%`, background: color }} />
    </div>
  );
}

export const isOther = (n) => /^Other|^Not reported/.test(n);
export const sortDealerNames = (counts) =>
  Object.keys(counts).sort((a, b) => Number(isOther(a)) - Number(isOther(b)) || counts[b] - counts[a]);

export function sumBy(rows, key, val) {
  const m = {};
  for (const r of rows) m[key(r)] = (m[key(r)] || 0) + val(r);
  return m;
}
