'use client';

import { useState } from 'react';
import { endLabel, fmt, mv, pct, qname, qv, signed, sortEnds, totals, yoyChanges } from '@/lib/wheelerPump/calc';
import { Legend, MiniChart } from '../charts';
import { Card, cx, DeltaChip, NoteButton, sumBy, useDash } from '../ui';
import { DealerTable } from './Dealers';

export default function Rolling() {
  const { data, loc, brand, locOk, brandOk } = useDash();
  const [showMonthly, setShowMonthly] = useState(false);
  const rows = data.r.filter((r) => locOk(r) && brandOk(r));
  if (!rows.length) {
    return (
      <Card
        title="No rolling 12-month reports for these filters"
        sub="Honda, Yamaha and Kawasaki usually send rolling 12-month reports. Upload them on the Upload tab and they'll be recognised and shown here."
      />
    );
  }
  const groups = [...new Set(rows.map((r) => `${r.location}|${r.brand}`))].sort();
  const changes = yoyChanges(rows);
  const latestEnd = (g) => sortEnds(rows.filter((r) => `${r.location}|${r.brand}` === g).map((r) => r.end)).pop();
  const chip = (d, up) => (d == null ? <span className={cx('chip')}>—</span> : <DeltaChip now={d} before={0} goodWhenUp={up} />);

  // Year-over-year rows aggregated to store · brand.
  const agg = {};
  for (const c of changes) {
    if (!showMonthly && !c.quarter) continue;
    const k = `${c.location}|${c.brand}|${c.end}`;
    agg[k] ||= { location: c.location, brand: c.brand, end: c.end, prevEnd: c.prevEnd, quarter: c.quarter, dLocal: 0, dPin: 0, dPout: 0 };
    agg[k].dLocal += c.dLocal;
    agg[k].dPin += c.dPin;
    agg[k].dPout += c.dPout;
  }
  const ys = Object.values(agg).sort((a, b) => mv(b.end) - mv(a.end)
    || a.location.localeCompare(b.location)
    || a.brand.localeCompare(b.brand));

  let dealers;
  if (loc !== 'All' && brand !== 'All') {
    const ends = sortEnds(data.rd.filter((d) => d.location === loc && d.brand === brand).map((d) => d.end));
    const E = ends[ends.length - 1];
    const P = ends[ends.length - 2] ?? null;
    const by = (dir, e) => sumBy(
      data.rd.filter((d) => d.location === loc && d.brand === brand && d.dir === dir && d.end === e),
      (d) => d.name,
      (d) => d.units
    );
    const sub = `Rolling 12 to ${E ? endLabel(E) : '—'}${P ? `, compared with rolling 12 to ${endLabel(P)}` : ''}.`;
    dealers = (
      <div className={cx('grid2e')}>
        <Card title="Who sells into the market" sub={sub}>
          <DealerTable dir="In" cur={by('In', E)} prev={P ? by('In', P) : null} curLabel={E ? endLabel(E) : ''} prevLabel={P ? endLabel(P) : null} loc={loc} />
        </Card>
        <Card title="Where the store sells out" sub={sub}>
          <DealerTable dir="Out" cur={by('Out', E)} prev={P ? by('Out', P) : null} curLabel={E ? endLabel(E) : ''} prevLabel={P ? endLabel(P) : null} loc={loc} />
        </Card>
      </div>
    );
  } else {
    dealers = (
      <Card title="Dealers and markets">
        <p className={cx('empty')}>Pick one store and one brand above to see who sells into that market over the rolling 12 months.</p>
      </Card>
    );
  }

  return (
    <div className={cx('stack')}>
      <Card
        title="Latest rolling 12 months"
        sub="The most recent 12-month report for each store and brand. The two change columns compare the last 3 months with the same 3 months a year earlier (this report minus the one from 3 months before)."
      >
        <div className={cx('tblWrap')}>
          <table>
            <thead>
              <tr>
                {['Store · brand / line', 'Window', 'Local', 'Pumped in', 'Pumped out', 'Net', 'Share', 'Δ local, last 3 mo', 'Δ in, last 3 mo', 'Notes'].map((x) => <th key={x}>{x}</th>)}
              </tr>
            </thead>
            <tbody>
              {groups.flatMap((g) => {
                const [l, b] = g.split('|');
                const E = latestEnd(g);
                const gr = rows.filter((r) => r.location === l && r.brand === b && r.end === E).sort((a, c) => a.line.localeCompare(c.line));
                const t = totals(gr);
                const st = gr[0]?.start;
                const gch = changes.filter((c) => c.location === l && c.brand === b && c.end === E);
                const dPin = gch.length ? gch.reduce((a, c) => a + c.dPin, 0) : null;
                const dLoc = gch.length ? gch.reduce((a, c) => a + c.dLocal, 0) : null;
                const out = [
                  <tr className={cx('grp')} key={g}>
                    <td>{l} · {b}</td>
                    <td className={cx('txt')}>{(st ? `${endLabel(st)} – ` : 'to ') + endLabel(E)}</td>
                    <td>{fmt(t.local)}</td>
                    <td>{fmt(t.pin)}</td>
                    <td>{fmt(t.pout)}</td>
                    <td>{signed(t.net)}</td>
                    <td>{pct(t.share)}</td>
                    <td>{chip(dLoc, true)}</td>
                    <td>{chip(dPin, false)}</td>
                    <td><NoteButton ctx={{ location: l, brand: b, line: null }} label={`${b} · ${l}`} /></td>
                  </tr>,
                ];
                if (gr.length > 1 || (gr[0] && gr[0].line !== 'All')) {
                  for (const r of gr) {
                    const c = gch.find((x) => x.line === r.line);
                    const tt = totals([r]);
                    out.push(
                      <tr key={g + r.line}>
                        <td className={cx('txt', 'ind')}>{r.line}</td>
                        <td />
                        <td>{fmt(r.local)}</td>
                        <td>{fmt(r.pin)}</td>
                        <td>{fmt(r.pout)}</td>
                        <td>{signed(tt.net)}</td>
                        <td>{pct(tt.share)}</td>
                        <td>{chip(c?.dLocal, true)}</td>
                        <td>{chip(c?.dPin, false)}</td>
                        <td><NoteButton ctx={{ location: l, brand: b, line: r.line }} label={`${b} ${r.line} · ${l}`} /></td>
                      </tr>
                    );
                  }
                }
                return out;
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title="Same quarter, year over year"
        sub="Worked out by subtracting rolling reports 3 months apart. It shows the change, not the quarter's own total. The exact quarter appears in the quarterly views once that brand's same quarter a year earlier is loaded."
        action={(
          <label className={cx('status')} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={showMonthly} onChange={(e) => setShowMonthly(e.target.checked)} />
            Include month-end windows
          </label>
        )}
      >
        {ys.length ? (
          <div className={cx('tblWrap')}>
            <table>
              <thead>
                <tr>{['Store · brand', 'Period', 'Δ Local', 'Δ Pumped in', 'Δ Pumped out', 'Δ Net', 'Notes'].map((x) => <th key={x}>{x}</th>)}</tr>
              </thead>
              <tbody>
                {ys.map((a) => (
                  <tr key={a.location + a.brand + a.end}>
                    <td className={cx('txt')}>{a.location} · {a.brand}</td>
                    <td className={cx('txt')} title={`Rolling 12 to ${endLabel(a.end)} minus rolling 12 to ${endLabel(a.prevEnd)}`}>
                      {a.quarter ? `${a.quarter} vs ${qname(qv(a.quarter) - 4)}` : `3 mo to ${endLabel(a.end)} vs a year earlier`}
                    </td>
                    <td>{chip(a.dLocal, true)}</td>
                    <td>{chip(a.dPin, false)}</td>
                    <td>{chip(a.dPout, true)}</td>
                    <td>{chip(a.dPout - a.dPin, true)}</td>
                    <td>
                      <NoteButton
                        ctx={a.quarter ? { location: a.location, brand: a.brand, quarterStrict: a.quarter } : { location: a.location, brand: a.brand }}
                        label={`${a.brand} · ${a.location}${a.quarter ? ` · ${a.quarter}` : ''}`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={cx('empty')}>Needs two rolling reports for the same store and brand, ending 3 months apart (for example March and June).</p>
        )}
      </Card>

      <div className={cx('stack')} style={{ gap: 8 }}>
        <div className={cx('cardhead')}>
          <h2 className={cx('sectionTitle')} style={{ margin: 0, fontSize: 13 }}>Rolling 12-month trend</h2>
          <Legend />
        </div>
        <div className={cx('miniGrid')}>
          {groups.map((g) => {
            const [l, b] = g.split('|');
            const ends = sortEnds(rows.filter((r) => r.location === l && r.brand === b).map((r) => r.end));
            const series = ends.map((e) => ({
              label: endLabel(e),
              span: [mv(e) - 11, mv(e)],
              ...totals(rows.filter((r) => r.location === l && r.brand === b && r.end === e)),
            }));
            return (
              <Card
                key={g}
                className={cx('chartCard')}
                title={`${l} · ${b}`}
                sub={ends.length > 1 ? `${ends.length} rolling reports` : 'One rolling report so far. The trend starts with the next one.'}
              >
                <MiniChart series={series} />
              </Card>
            );
          })}
        </div>
      </div>
      {dealers}
    </div>
  );
}
