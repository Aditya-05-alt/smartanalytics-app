'use client';

import { compare, fmt, notesFor, pct, periodSpan, signed, totals } from '@/lib/wheelerPump/calc';
import { Legend, TrendChart } from '../charts';
import { NoteCard } from '../NotesSheet';
import { Card, cx, DeltaChip, NoPrior, NoteButton, useDash } from '../ui';

function Kpi({ label, color, value, chip, hint }) {
  return (
    <div className={cx('kpi')} style={color ? { '--kc': color } : undefined}>
      <div className={cx('lab')}>{color && <i style={{ background: color }} />}{label}</div>
      <div className={cx('val')}>{value}</div>
      <div className={cx('hint')}>{chip} {hint}</div>
    </div>
  );
}

export default function Overview() {
  const { data, sum, period, q, loc, brand, locOk, brandOk, isWheeler, openNotes, setQ, setTab } = useDash();
  if (!q) return null;
  const isR12 = period.mode === 'r12';
  const qLabel = period.label(q);
  const cmp = compare(sum, q, (r) => locOk(r) && brandOk(r), period.prev(q));
  const T = cmp.cur;
  const L = cmp.curLfl;
  const P = cmp.hasPrev ? cmp.prv : null;
  const locCtx = loc === 'All' ? null : loc;

  const gaps = [
    ...cmp.onlyCur.map((k) => `${k.replace('|', ' · ')} has no ${period.label(cmp.p)} data`),
    ...cmp.onlyPrev.map((k) => `${k.replace('|', ' · ')} has no ${qLabel} data`),
  ];
  const r12Only = isR12 ? [] : [...new Set(data.r.filter((r) => locOk(r) && brandOk(r)).map((r) => `${r.location} · ${r.brand}`))]
    .filter((x) => !sum.some((r) => r.quarter === q && `${r.location} · ${r.brand}` === x))
    .sort();
  const hasCalc = sum.some((r) => r.calc && r.quarter === q && locOk(r) && brandOk(r));

  const trendRows = sum.filter((r) => locOk(r) && brandOk(r));
  const qNotes = (qq) => notesFor(data.notes, { location: locCtx, quarterStrict: qq })
    .filter((n) => brand === 'All' || !n.brand || n.brand === brand);
  const series = period.sort(trendRows.map((r) => r.quarter)).map((qq) => {
    const rows = trendRows.filter((r) => r.quarter === qq);
    return {
      key: qq,
      label: period.label(qq).replace('12 mo to ', ''),
      caption: period.label(qq),
      span: periodSpan(qq),
      ...totals(rows),
      notes: qNotes(qq).length,
      extra: `${new Set(rows.map((r) => r.location + r.brand)).size} store–brand reports`,
    };
  });

  const curRows = sum.filter((r) => r.quarter === q && brandOk(r));
  const prvRows = sum.filter((r) => r.quarter === cmp.p && brandOk(r));
  const locs = [...new Set(curRows.map((r) => r.location))];
  const brandsCur = [...new Set(curRows.filter(locOk).map((r) => r.brand))].sort();
  const quarterNotes = qNotes(q);

  return (
    <div className={cx('stack')}>
      <div className={cx('kpis')}>
        <Kpi label="Local sales" color="var(--local)" value={fmt(T.local)} chip={<DeltaChip now={L.local} before={P?.local} goodWhenUp />} hint="sold inside own market" />
        <Kpi label="Pumped in" color="var(--in)" value={fmt(T.pin)} chip={<DeltaChip now={L.pin} before={P?.pin} goodWhenUp={false} />} hint="other dealers into market" />
        <Kpi label="Pumped out" color="var(--out)" value={fmt(T.pout)} chip={<DeltaChip now={L.pout} before={P?.pout} goodWhenUp />} hint="sold outside market" />
        <Kpi label="Net" value={signed(T.net)} chip={<DeltaChip now={L.net} before={P?.net} goodWhenUp />} hint="out − in" />
        <Kpi label="Local share" value={pct(T.share)} chip={<DeltaChip now={L.share} before={P?.share} goodWhenUp isPct />} hint="of local buyers won" />
      </div>
      {cmp.hasPrev && gaps.length > 0 && (
        <div className={cx('banner')}>
          <b>Not in the comparison: </b>{gaps.join('; ')}. These stay in the totals above but are left out of the change chips.
        </div>
      )}
      {isR12 && (
        <div className={cx('banner', 'bannerAccent')}>
          <b>Rolling 12-month view: </b>each figure covers the 12 months ending {qLabel.replace('12 mo to ', '')}. Changes compare with the 12 months ending a year earlier. Switch Period to Quarterly once quarterly reports are loaded.
        </div>
      )}
      {r12Only.length > 0 && (
        <div className={cx('banner', 'bannerAccent', 'bannerRow')}>
          <span>
            <b>Rolling 12-month reports only: </b>{r12Only.join(', ')}. They aren&apos;t in these quarterly totals; see their trend and year-over-year change on the rolling tab.
          </span>
          <button className={cx('btn')} type="button" onClick={() => setTab('r12')}>Rolling 12 months</button>
        </div>
      )}
      {hasCalc && (
        <div className={cx('banner')}>
          <b>Includes calculated figures: </b>some {q} numbers are worked out from rolling 12-month reports and the same quarter a year earlier. They&apos;re marked &quot;calc&quot; on the Brands tab.
        </div>
      )}

      <div className={cx('grid2')}>
        <Card
          className={cx('chartCard')}
          title={{ r12: 'Rolling 12 months, window by window', m: 'Month by month', q: 'Quarter by quarter' }[period.mode]}
          sub={`${loc === 'All' ? 'All stores' : loc} · ${brand === 'All' ? 'all brands' : brand}. Purple dots mark ${period.units} with notes. Click a ${period.unit} to select it.`}
        >
          <Legend />
          <TrendChart series={series} selected={q} onPick={setQ} />
        </Card>
        <Card
          title={`What happened in ${qLabel}`}
          sub={`Notes for this ${period.unit}${loc === 'All' ? '' : ` at ${loc}`}.`}
          action={isWheeler ? (
            <button
              className={cx('btn')}
              type="button"
              onClick={() => openNotes({ location: locCtx, quarter: q, brand: brand === 'All' ? null : brand }, `${qLabel} notes`, true)}
            >
              + Add note
            </button>
          ) : undefined}
        >
          {quarterNotes.length
            ? <div className={cx('notes')}>{quarterNotes.slice(0, 6).map((n) => <NoteCard key={n.id} n={n} />)}</div>
            : (
              <p className={cx('empty')}>
                No notes for {qLabel} yet.{isWheeler ? ' Add context like a stock shortage, a promo or a staffing change so the numbers make sense later.' : ''}
              </p>
            )}
        </Card>
      </div>

      <div className={cx('grid2e')}>
        <Card title={`By store · ${qLabel}`} sub={`Click a note pill to see or add context for that store and ${period.unit}.`}>
          <div className={cx('tblWrap')}>
            <table>
              <thead>
                <tr>{['Store', 'Local', 'Pumped in', 'Pumped out', 'Net', 'Local share', 'Δ pumped in', 'Notes'].map((x) => <th key={x}>{x}</th>)}</tr>
              </thead>
              <tbody>
                {locs.map((l) => {
                  const t = totals(curRows.filter((r) => r.location === l));
                  const pr = prvRows.filter((r) => r.location === l);
                  const both = new Set(pr.map((r) => r.brand));
                  const tl = totals(curRows.filter((r) => r.location === l && both.has(r.brand)));
                  const tp = totals(pr.filter((r) => curRows.some((c) => c.location === l && c.brand === r.brand)));
                  return (
                    <tr key={l}>
                      <td className={cx('txt')}><b>{l}</b></td>
                      <td>{fmt(t.local)}</td>
                      <td>{fmt(t.pin)}</td>
                      <td>{fmt(t.pout)}</td>
                      <td>{signed(t.net)}</td>
                      <td>{pct(t.share)}</td>
                      <td>{pr.length ? <DeltaChip now={tl.pin} before={tp.pin} goodWhenUp={false} /> : <NoPrior />}</td>
                      <td>
                        <NoteButton
                          ctx={brand === 'All' ? { location: l, quarterStrict: q } : { location: l, quarterStrict: q, brand }}
                          label={`${l} · ${qLabel}`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title={`By brand · ${qLabel}`} sub={loc === 'All' ? 'All stores combined.' : `${loc} only.`}>
          <div className={cx('tblWrap')}>
            <table>
              <thead>
                <tr>{['Brand', 'Local', 'Pumped in', 'Pumped out', 'Net', 'Share'].map((x) => <th key={x}>{x}</th>)}</tr>
              </thead>
              <tbody>
                {brandsCur.map((b) => {
                  const t = totals(curRows.filter((r) => locOk(r) && r.brand === b));
                  return (
                    <tr key={b}>
                      <td className={cx('txt')}>{b}</td>
                      <td>{fmt(t.local)}</td>
                      <td>{fmt(t.pin)}</td>
                      <td>{fmt(t.pout)}</td>
                      <td>{signed(t.net)}</td>
                      <td>{pct(t.share)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Card title="How to read this">
        <div className={cx('defs')}>
          <div><b>Local sales. </b>Units the store sold to buyers inside its own market area (PMA; SEA for Kawasaki).</div>
          <div><b>Pumped in. </b>Units other dealers sold to buyers inside the store&apos;s market area. Sister stores count as other dealers.</div>
          <div><b>Pumped out. </b>Units the store sold to buyers outside its market area.</div>
          <div><b>Net and local share. </b>Net is pumped out minus pumped in; higher is better. Local share is local ÷ (local + pumped in).</div>
        </div>
      </Card>
    </div>
  );
}
