'use client';

import { fmt } from '@/lib/wheelerPump/calc';
import { Bar, Card, cx, DeltaChip, NoteButton, sortDealerNames, sumBy, useDash } from '../ui';

export function DealerTable({ dir, cur, prev, curLabel, prevLabel, loc }) {
  const names = sortDealerNames(cur);
  const max = Math.max(1, ...Object.values(cur));
  const color = dir === 'In' ? 'var(--in)' : 'var(--out)';
  if (!names.length) {
    return <p className={cx('empty')}>No {dir === 'In' ? 'dealer' : 'market'} detail for {curLabel}.</p>;
  }
  return (
    <div className={cx('tblWrap')}>
      <table>
        <thead>
          <tr>
            {[dir === 'In' ? 'Dealer' : 'Market', '', curLabel, ...(prev ? [prevLabel ?? 'Prior', 'Change'] : []), 'Notes']
              .map((x, i) => <th key={i}>{x}</th>)}
          </tr>
        </thead>
        <tbody>
          {names.map((n) => (
            <tr key={n}>
              <td className={cx('txt')}>{n}</td>
              <td><Bar value={cur[n]} max={max} color={color} /></td>
              <td>{fmt(cur[n])}</td>
              {prev && <td>{n in prev ? fmt(prev[n]) : '—'}</td>}
              {prev && (
                <td>
                  {n in prev
                    ? <DeltaChip now={cur[n]} before={prev[n]} goodWhenUp={dir === 'Out'} />
                    : <span className={cx('chip')}>new</span>}
                </td>
              )}
              <td><NoteButton ctx={{ location: loc, dealer: n }} label={n} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Dealers() {
  const { dl, period, q, loc, locOk, brandOk } = useDash();
  if (!q) return null;
  const p = period.prev(q);
  const rows = dl.filter((r) => locOk(r) && brandOk(r));
  const lc = loc === 'All' ? null : loc;
  const agg = (dir, qq) => sumBy(rows.filter((r) => r.dir === dir && r.quarter === qq), (r) => r.name, (r) => r.units);
  const block = (dir, title, sub) => {
    const cur = agg(dir, q);
    const prev = agg(dir, p);
    const total = Object.values(cur).reduce((a, b) => a + b, 0);
    return (
      <Card title={title} sub={`${sub} Total ${fmt(total)} units.`}>
        <DealerTable
          dir={dir}
          cur={cur}
          prev={Object.keys(prev).length ? prev : null}
          curLabel={period.label(q)}
          prevLabel={p ? period.label(p) : null}
          loc={lc}
        />
      </Card>
    );
  };
  return (
    <div className={cx('grid2e')}>
      {block('In', 'Who sells into the market', `Other dealers selling to buyers inside ${lc ?? 'each store'}'s market area.`)}
      {block('Out', 'Where the store sells out', `Markets outside ${lc ?? 'each store'}'s area that the store sold into.`)}
    </div>
  );
}
