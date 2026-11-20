import type { CSSProperties } from 'react';

// A plain report table: one body row per record, the last record as the total row.
type Col<R> = { key: string; label: string; fmt?: (v: R[keyof R], row: R) => string; bold?: boolean; left?: boolean };

export default function Table<R extends Record<string, unknown>>({
  cols, rows, total, sharedLabel, empty = 'No data for these dates.', bodyScrollRows,
}: {
  cols: Col<R>[];
  rows: R[];
  total?: R;
  sharedLabel?: string;
  empty?: string;
  /** Cap visible body rows; overflow scrolls (header + total stay put). */
  bodyScrollRows?: number;
}) {
  if (!rows.length && !total) return <p className="empty">{empty}</p>;
  const cell = (r: R, c: Col<R>) => {
    const v = r[c.key as keyof R];
    return c.fmt ? c.fmt(v, r) : v == null ? '–' : String(v);
  };
  const scroll = bodyScrollRows != null && bodyScrollRows > 0 && rows.length > bodyScrollRows;
  return (
    <div
      className={'tbl' + (scroll ? ' tbl-scroll' : '')}
      style={scroll ? ({ '--wr-tbl-rows': bodyScrollRows } as CSSProperties) : undefined}
    >
      <table>
        <thead><tr>{cols.map((c) => <th key={c.key} className={c.left ? 'l' : undefined}>{c.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={sharedLabel && r[cols[0].key as keyof R] === sharedLabel ? 'shared' : undefined}>
              {cols.map((c) => <td key={c.key} className={[c.bold ? 'b' : '', c.left ? 'l' : ''].join(' ').trim() || undefined}>{cell(r, c)}</td>)}
            </tr>
          ))}
        </tbody>
        {total && <tfoot><tr>{cols.map((c) => <td key={c.key} className={c.left ? 'l' : undefined}>{cell(total, c)}</td>)}</tr></tfoot>}
      </table>
    </div>
  );
}

export const Card = ({ id, title, sub, wide, children, foot }: { id: string; title: string; sub?: string; wide?: boolean; children: React.ReactNode; foot?: React.ReactNode }) => (
  <section className={'card' + (wide ? ' wide' : '')} aria-labelledby={id}>
    <div className="bar"><h2 id={id}>{title}</h2>{sub && <span>{sub}</span>}</div>
    {children}
    {foot && <p className="foot">{foot}</p>}
  </section>
);
