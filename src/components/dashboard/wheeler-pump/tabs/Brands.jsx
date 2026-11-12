'use client';

import { fmt, pct, signed, totals } from '@/lib/wheelerPump/calc';
import { Spark } from '../charts';
import { Card, cx, DeltaChip, NoPrior, NoteButton, useDash } from '../ui';

export default function Brands() {
  const { sum, period, q, loc, locOk, brandOk } = useDash();
  if (!q) return null;
  const p = period.prev(q);
  const rows = sum.filter((r) => locOk(r) && brandOk(r));
  const qs = period.sort(rows.map((r) => r.quarter)).filter((x) => period.pv(x) <= period.pv(q)).slice(-6);
  const brands = [...new Set(rows.filter((r) => r.quarter === q).map((r) => r.brand))].sort();
  const lc = loc === 'All' ? null : loc;
  const single = qs.length <= 1;

  return (
    <Card
      title={`Brands and product lines · ${period.label(q)}`}
      sub={single
        ? `${loc === 'All' ? 'All stores combined' : loc}. Only one period is loaded, so the lines are flat at this period's level: pumped in (orange) and local sales (grey). They start to slope once a second period is uploaded.`
        : `${loc === 'All' ? 'All stores combined' : loc}. Trend lines show the last 6 ${period.units}: pumped in (orange) and local sales (grey). Notes on a model stay with it across ${period.units}.`}
    >
      {brands.length ? (
        <div className={cx('tblWrap')}>
          <table>
            <thead>
              <tr>
                {['Brand / line', 'Trend', 'Local', 'Pumped in', 'Pumped out', 'Net', 'Share', `Δ in vs ${p ? period.label(p) : 'prior'}`, 'Notes'].map((x) => <th key={x}>{x}</th>)}
              </tr>
            </thead>
            <tbody>
              {brands.flatMap((b) => {
                const br = rows.filter((r) => r.brand === b);
                const tq = totals(br.filter((r) => r.quarter === q));
                const tp = br.some((r) => r.quarter === p) ? totals(br.filter((r) => r.quarter === p)) : null;
                const maxv = Math.max(1, ...br.map((r) => Math.max(r.local, r.pin)));
                const lines = [...new Set(br.filter((r) => r.quarter === q).map((r) => r.line))].sort();
                return [
                  <tr className={cx('grp')} key={b}>
                    <td>{b}</td>
                    <td />
                    <td>{fmt(tq.local)}</td>
                    <td>{fmt(tq.pin)}</td>
                    <td>{fmt(tq.pout)}</td>
                    <td>{signed(tq.net)}</td>
                    <td>{pct(tq.share)}</td>
                    <td>{tp ? <DeltaChip now={tq.pin} before={tp.pin} goodWhenUp={false} /> : <NoPrior />}</td>
                    <td><NoteButton ctx={{ location: lc, brand: b, line: null }} label={b + (lc ? ` · ${lc}` : '')} /></td>
                  </tr>,
                  ...lines.map((l) => {
                    const lr = br.filter((r) => r.line === l);
                    const t = totals(lr.filter((r) => r.quarter === q));
                    const pr = lr.filter((r) => r.quarter === p);
                    const byQ = qs.map((qq) => {
                      const x = lr.filter((r) => r.quarter === qq);
                      return x.length ? totals(x) : null;
                    });
                    const calc = lr.find((r) => r.quarter === q && r.calc);
                    return (
                      <tr key={b + l}>
                        <td className={cx('txt', 'ind')} title={calc?.source ?? undefined}>
                          {l}{calc && <> <span className={cx('pill', 'pillWarn')}>calc</span></>}
                        </td>
                        <td>
                          <span style={{ display: 'inline-flex', gap: 2 }}>
                            <Spark vals={byQ.map((z) => z?.pin ?? null)} color="var(--in)" max={maxv} />
                            <Spark vals={byQ.map((z) => z?.local ?? null)} color="var(--local)" max={maxv} />
                          </span>
                        </td>
                        <td>{fmt(t.local)}</td>
                        <td>{fmt(t.pin)}</td>
                        <td>{fmt(t.pout)}</td>
                        <td>{signed(t.net)}</td>
                        <td>{pct(t.share)}</td>
                        <td>{pr.length ? <DeltaChip now={t.pin} before={totals(pr).pin} goodWhenUp={false} /> : <NoPrior />}</td>
                        <td><NoteButton ctx={{ location: lc, brand: b, line: l }} label={`${b} ${l}${lc ? ` · ${lc}` : ''}`} /></td>
                      </tr>
                    );
                  }),
                ];
              })}
            </tbody>
          </table>
        </div>
      ) : <p className={cx('empty')}>No brand data for {period.label(q)} with these filters.</p>}
    </Card>
  );
}
