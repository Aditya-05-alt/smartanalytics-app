'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import FilterDropdown from '../FilterDropdown';
import { CHANNELS, dealerChange, MIN_CHANNEL_VDP, pctChange } from '@/lib/vdpChange/calc';
import styles from './VdpChange.module.css';

const cx = (...names) => names.filter(Boolean).map((n) => styles[n] || n).join(' ');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** The Real change summary shows this many dealers; the rest scroll. */
const SUMMARY_ROWS_SHOWN = 10;
const THRESHOLDS = [5, 8, 12, 20];
const FLAGS = [3, 5, 10];
const MIN_VDP_OPTIONS = [
  { value: '0', label: 'Show all' },
  { value: '2000', label: 'Hide under 2,000 VDP' },
  { value: '5000', label: 'Hide under 5,000 VDP' },
];
const fmt = (n) => (n == null || !Number.isFinite(n) ? '—' : Math.round(n).toLocaleString('en-US'));
const r2 = (n) => (Number.isFinite(n) ? n.toFixed(2) : '—');
const pc = (n) => `${Math.round(n * 100)}%`;
function sg(n, d = 0) {
  if (n == null || !Number.isFinite(n)) return '—';
  const a = +Math.abs(n).toFixed(d);
  const text = a.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  return (a === 0 ? '' : n > 0 ? '+' : '−') + text;
}
const tone = (n) => (n == null ? '' : n < -0.05 ? 'down' : n > 0.05 ? 'up' : '');

function monthLabel(ym, from, to) {
  const [y, m] = ym.split('-').map(Number);
  const d1 = +from.slice(8);
  const d2 = +to.slice(8);
  return `${MON[m - 1]} ${d1}–${d2}, ${y}`;
}
function rangeLabel(from, to, withYear = true) {
  const [y, m] = from.split('-').map(Number);
  return `${MON[m - 1]} ${+from.slice(8)}–${+to.slice(8)}${withYear ? `, ${y}` : ''}`;
}
/** Each load step has no progress events, so the percent eases toward its target until the step finishes. */
function useLoadPercent(active, floor) {
  const [percent, setPercent] = useState(0);
  useEffect(() => {
    if (!active) {
      setPercent(100);
      return undefined;
    }
    setPercent((p) => Math.max(p, floor));
    const timer = setInterval(() => setPercent((v) => Math.min(95, v + Math.max(0.3, (95 - v) * 0.05))), 150);
    return () => clearInterval(timer);
  }, [active, floor]);
  return Math.round(Math.max(percent, floor));
}

function Seg({ value, options, onChange, label }) {
  return (
    <div className={cx('seg')} role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>{text}</button>
      ))}
    </div>
  );
}

function Worksheet({ d, lab0, lab1, sel, onSelect }) {
  const ch = sel === 'all' ? null : CHANNELS.find((c) => c.key === sel);
  const w = ch ? d.CW[ch.key] : d.W;
  const chName = ch ? ch.key : 'All channels';
  const look = ch ? (ch.paid || 'the site') : 'Google Ads / Meta for paid channels, the site for the rest';
  const D = (a, b) => <span className={cx(tone(b - a))}>{sg(b - a)}</span>;
  const step = (no, lbl, a, b, diff, how, cls = '') => (
    <tr className={cx(cls)} key={no}>
      <td className={cx('no')}>{no}</td>
      <td className={cx('lb')}>{lbl}</td>
      <td>{a}</td>
      <td>{b}</td>
      <td>{diff}</td>
      <td className={cx('how')}>{how}</td>
    </tr>
  );
  const sec = (text) => <tr className={cx('sec')} key={text}><td colSpan={6}>{text}</td></tr>;
  const B = (n, d0 = 0, suffix = '') => <b className={cx(tone(n))}>{sg(n, d0)}{n == null ? '' : suffix}</b>;
  return (
    <div className={cx('ws')}>
      <div className={cx('pills')}>
        {[['all', 'All channels'], ...CHANNELS.map((c) => [c.key, c.key])].map(([k, n]) => (
          <button key={k} type="button" className={cx('pill')} aria-pressed={k === sel} onClick={() => onSelect(k)}>{n}</button>
        ))}
      </div>
      <div className={cx('tw')}>
        <table className={cx('wst')}>
          <thead>
            <tr>
              <th />
              <th className={cx('l')}>{chName}</th>
              <th>{lab0}</th>
              <th>{lab1}</th>
              <th>Difference</th>
              <th className={cx('l')}>How it&apos;s calculated</th>
            </tr>
          </thead>
          <tbody>
            {sec('1 · How much VDP changed')}
            {step('A', 'VDP views', fmt(w.v0), fmt(w.v1), B(w.diff), 'Final VDP views (same rules as Overview)')}
            {step('B', 'VDP change %', '', '', B(w.diffPct, 1, '%'), `${sg(w.diff)} ÷ ${fmt(w.v0)}`)}
            {sec('2 · How much of that is explained by traffic')}
            {step('C', 'Users', fmt(w.u0), fmt(w.u1), D(w.u0, w.u1), 'From GA4')}
            {step('D', '× Sessions per user', r2(w.spu0), r2(w.spu1), '', 'GA4 sessions ÷ users')}
            {step('E', '= Sessions', fmt(w.s0), fmt(w.s1), D(w.s0, w.s1), 'C × D')}
            {step('F', '× Pages per session', r2(w.pps0), r2(w.pps1), '', 'GA4 page views ÷ sessions')}
            {step('G', '= Page views', fmt(w.pv0), fmt(w.pv1), D(w.pv0, w.pv1), 'E × F')}
            {w.rate != null ? (
              <>
                {step('H', '× Standard VDP rate', pc(w.rate), pc(w.rate), '', `Same ${pc(w.rate)} for every dealer`)}
                {step('I', '= Estimated VDP views', fmt(w.e0), fmt(w.e1), D(w.e0, w.e1), 'G × H')}
              </>
            ) : (
              <>
                {step('H', '× Standard VDP rates', `${pc(w.r0)} blended`, `${pc(w.r1)} blended`, '', "Each channel's own standard rate")}
                {step('I', '= Estimated VDP views', fmt(w.e0), fmt(w.e1), D(w.e0, w.e1), "Sum of each channel's page views × its rate")}
              </>
            )}
            {step('J', 'Estimated change %', '', '', B(w.ePct, 1, '%'), w.ePct == null ? 'No traffic last period' : `${sg(w.e1 - w.e0)} ÷ ${fmt(w.e0)}`)}
            {step('K', 'VDP change explained by traffic', '', '', B(w.traffic), w.ePct == null ? 'All of it: the traffic is new' : `J × last period's actual VDP (${sg(w.ePct, 1)}% × ${fmt(w.v0)})`, 'key')}
            {sec("3 · What's left (the real change)")}
            {step('L', 'Real change in VDP views', '', '', B(w.real), `A − K (${sg(w.diff)} − (${sg(w.traffic)}))`, 'key')}
            {step('M', 'Real change %', '', '', B(w.realPct, 1, '%'), `${sg(w.real)} ÷ ${fmt(w.v0)}`, 'key big')}
          </tbody>
        </table>
      </div>
      {w.v0 > 0 && (
        <div className={cx('concl')}>
          <b>In plain words:</b> VDP views went {w.diff < 0 ? 'down' : 'up'} {fmt(Math.abs(w.diff))} ({Math.abs(w.diffPct).toFixed(1)}%).
          {' '}Changes in users, sessions and pages per session account for {fmt(Math.abs(w.traffic))} of that. The other
          {' '}<b>{fmt(Math.abs(w.real))} ({Math.abs(w.realPct).toFixed(1)}%)</b> is the real {w.real < 0 ? 'drop' : 'gain'} to find in {look}.
        </div>
      )}
    </div>
  );
}

export default function VdpChange() {
  const [compare, setCompare] = useState('pm');
  const [dir, setDir] = useState('down');
  // 0 = no minimum: no percent preset is selected until the user picks one.
  const [thr, setThr] = useState(0);
  const [on, setOn] = useState('vdp');
  const [minv, setMinv] = useState(2000);
  const [flag, setFlag] = useState(5);
  const [onlyFlagged, setOnlyFlagged] = useState(true);
  // Selected dealer names; empty = all dealers.
  const [pickedDealers, setPickedDealers] = useState([]);
  // Dealer cards listed below the table, and which of them have their worksheet dropped down.
  const [listIds, setListIds] = useState(() => new Set());
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const [all, setAll] = useState(false);
  const [chSel, setChSel] = useState({});
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [stepFloor, setStepFloor] = useState(0);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const loadPercent = useLoadPercent(loading, stepFloor);
  const summaryScrollRef = useRef(null);
  const [summaryBox, setSummaryBox] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const query = new URLSearchParams({ compare });
    const fetchJson = async (url, init) => {
      const res = await fetch(url, { credentials: 'same-origin', ...init });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `VDP Change request failed (${res.status})`);
      return body;
    };
    setLoading(true);
    setError('');
    setStepFloor(0);
    (async () => {
      try {
        setStatus('Checking GA4 traffic…');
        const { missing = [], chunkSize = 10 } = await fetchJson(`/api/dashboard/vdp-change/traffic?${query}`);
        if (missing.length) {
          const chunks = [];
          for (let i = 0; i < missing.length; i += chunkSize) chunks.push(missing.slice(i, i + chunkSize));
          let done = 0;
          setStatus(`Fetching GA4 traffic for ${missing.length} dealers…`);
          await Promise.all(chunks.map(async (clientIds) => {
            await fetchJson(`/api/dashboard/vdp-change/traffic?${query}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ clientIds }),
            }).catch(() => null);
            done += 1;
            if (!cancelled) setStepFloor(5 + (80 * done) / chunks.length);
          }));
        }
        if (cancelled) return;
        setStepFloor(missing.length ? 88 : 40);
        setStatus('Loading VDP views and traffic…');
        const result = await fetchJson(`/api/dashboard/vdp-change?${query}`);
        if (!cancelled) setPayload(result);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load VDP Change');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [compare]);

  const rates = useMemo(
    () => Object.fromEntries((payload?.rates ?? []).map((r) => [r.grp, r.rate])),
    [payload]
  );
  const dealers = useMemo(
    () => (payload?.dealers ?? []).map((d) => dealerChange(d, rates)).filter(Boolean),
    [payload, rates]
  );
  const noTraffic = (payload?.dealers?.length ?? 0) - dealers.length;
  const periods = payload?.periods;
  const lab1 = periods ? rangeLabel(periods.from, periods.to, compare === 'ly') : '';
  const lab0 = periods ? rangeLabel(periods.prevFrom, periods.prevTo, compare === 'ly') : '';

  const base = dealers.filter((d) => d.V0 >= minv);
  const val = (d) => (on === 'vdp' ? d.W.diffPct : d.W.realPct);
  const passesDirection = (d) => {
    const v = val(d);
    if (v == null) return false;
    return dir === 'both' ? Math.abs(v) >= thr : dir === 'down' ? v <= -thr : v >= thr;
  };

  // Like for like: dealers without VDP in the earlier period (e.g. no data a year ago) are left out of the total.
  const comparable = dealers.filter((d) => d.V0 > 0 && d.V1 > 0);
  const T0 = comparable.reduce((a, d) => a + d.V0, 0);
  const T1 = comparable.reduce((a, d) => a + d.V1, 0);
  const stocked = dealers.filter((d) => d.inv0 != null && d.inv1 != null);
  const I0 = stocked.reduce((a, d) => a + d.inv0, 0);
  const I1 = stocked.reduce((a, d) => a + d.inv1, 0);

  const flaggedOf = (d) => (d.W.realPct != null && d.W.realPct <= -flag)
    || CHANNELS.some(({ key }) => d.CW[key].v0 >= MIN_CHANNEL_VDP && d.CW[key].realPct <= -flag);
  const dealerOptions = [
    { value: 'All', label: 'All Dealers' },
    ...[...new Set(dealers.map((d) => d.name))].sort((a, b) => a.localeCompare(b)).map((n) => ({ value: n, label: n })),
  ];
  const picked = new Set(pickedDealers);
  const summaryRows = base
    .filter((d) => !picked.size || picked.has(d.name))
    .filter(passesDirection)
    .filter((d) => !onlyFlagged || flaggedOf(d))
    .sort((a, b) => a.name.localeCompare(b.name));
  const openDealers = summaryRows.filter((d) => all || listIds.has(d.clientId));
  // Cap the summary at SUMMARY_ROWS_SHOWN dealers using the rendered header, count-row and row heights.
  useLayoutEffect(() => {
    const scroller = summaryScrollRef.current;
    const head = scroller?.querySelector('thead');
    const count = scroller?.querySelector('tbody tr');
    const row = scroller?.querySelector('tbody tr:nth-child(2)');
    if (!head || !count || !row) return;
    setSummaryBox({
      maxHeight: head.offsetHeight + count.offsetHeight + row.offsetHeight * SUMMARY_ROWS_SHOWN + 1,
      '--vc-head-h': `${head.offsetHeight}px`,
    });
  }, [summaryRows.length, loading]);

  const flagCount = (key) => base.filter((d) => (key === 'T'
    ? d.W.realPct != null && d.W.realPct <= -flag
    : d.CW[key].v0 >= MIN_CHANNEL_VDP && d.CW[key].realPct <= -flag)).length;

  const isExpanded = (id) => expandedIds.has(id);
  /** From the table: list the dealer's card with its worksheet dropped down, and scroll to it. */
  const openWorksheet = (id) => {
    setListIds((current) => new Set(current).add(id));
    setExpandedIds((current) => new Set(current).add(id));
    requestAnimationFrame(() => document.getElementById(`vdpc-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };
  /** Card header: drop the worksheet down or fold it back up. */
  const toggleWorksheet = (id) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  /** Picking dealers in the dropdown opens their worksheets; dealers dropped from the pick are closed. */
  const pickDealers = (names) => {
    const idsOf = (list) => new Set(dealers.filter((d) => list.includes(d.name)).map((d) => d.clientId));
    const before = idsOf(pickedDealers);
    const after = idsOf(names);
    const apply = (current) => {
      const next = new Set([...current].filter((id) => !before.has(id) || after.has(id)));
      after.forEach((id) => { if (!before.has(id)) next.add(id); });
      return next;
    };
    setPickedDealers(names);
    setListIds(apply);
    setExpandedIds(apply);
  };
  /** Expand all lists every dealer in the table as a collapsed card; Collapse all clears the list. */
  const toggleAll = () => {
    if (all) {
      setListIds(new Set());
      setExpandedIds(new Set());
    }
    setAll((v) => !v);
  };

  const summaryCell = (w, key, total = false) => {
    if (!w || w.v0 < MIN_CHANNEL_VDP || w.realPct == null) return <td key={key} className={cx('c', total && 'tt')}>—</td>;
    const v = w.realPct;
    const cls = v <= -2 * flag ? 'f2' : v <= -flag ? 'f1' : v >= flag ? 'g' : '';
    return <td key={key} className={cx('c', cls, total && 'tt')}>{sg(v, 1)}%</td>;
  };

  return (
    <div className={cx('root')} aria-busy={loading}>
      {loading && (
        <div className={`adc-table-overlay ${cx('loadingOverlay')}`} role="status" aria-live="polite" aria-label={`Loading ${loadPercent}%${status ? ` · ${status}` : ''}`}>
          <div className="adc-table-loader dealer-compare-loader">
            <span className="adc-table-spinner" aria-hidden />
            <span className="adc-table-loader-text">Loading {loadPercent}%</span>
          </div>
        </div>
      )}

      {loading && (
        <div className="adc-nav-progress" role="progressbar" aria-label="Loading" aria-busy="true">
          <div className="adc-nav-progress-bar" />
        </div>
      )}

      <div className={`content ${cx('page')}`}>
        <header className={cx('heading')}>
          <h1>VDP Change</h1>
          <p>
            {periods ? (
              <>
                <b>{monthLabel(periods.month, periods.from, periods.to)}</b> vs <b>{rangeLabel(periods.prevFrom, periods.prevTo)}</b>
                {' '}· data through {periods.throughDate} (two days back, because GA4&apos;s last two days aren&apos;t final).
              </>
            ) : 'VDP views this period against the previous month or the same month last year.'}
          </p>
        </header>

        <div className={cx('filterCard')}>
          <div className={cx('fld')}>
            <span className={cx('lab')}>Compare with</span>
            <Seg label="Compare with" value={compare} onChange={setCompare} options={[['pm', 'Previous month'], ['ly', 'Same month last year']]} />
          </div>
          <div className={cx('fld')}>
            <span className={cx('lab')}>Direction</span>
            <Seg label="Direction" value={dir} onChange={setDir} options={[['down', 'Down'], ['up', 'Up'], ['both', 'Both']]} />
          </div>
          <div className={cx('fld')}>
            <span className={cx('lab')}>Change at least</span>
            <div className={cx('fldRow')}>
              <Seg label="Change at least" value={thr} onChange={setThr} options={THRESHOLDS.map((t) => [t, `${t}%`])} />
              <input
                className={cx('num')}
                type="number"
                min={0}
                max={100}
                value={thr || ''}
                placeholder="0"
                onChange={(e) => setThr(Math.max(0, Number(e.target.value) || 0))}
                aria-label="Change at least, percent"
              />
              %
            </div>
          </div>
          <div className={cx('fld')}>
            <span className={cx('lab')}>Apply to</span>
            <Seg label="Apply to" value={on} onChange={setOn} options={[['vdp', 'VDP change'], ['real', 'Real change']]} />
          </div>
          <label className={cx('fld')}>
            <span className={cx('lab')}>Smallest dealers</span>
            <select className={cx('dd')} value={String(minv)} onChange={(e) => setMinv(Number(e.target.value))}>
              {MIN_VDP_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <div className={cx('fld', 'fldEnd')}>
            <button type="button" className={cx('btn')} onClick={toggleAll}>{all ? 'Collapse all' : 'Expand all'}</button>
          </div>
        </div>

        {error && <p className={cx('error')} role="alert">Could not load VDP Change: {error}</p>}

        {payload && (
          <>
            <div className={cx('std')}>
              <span className={cx('lab')}>Standard VDP rate per channel</span>
              {CHANNELS.map(({ key }) => (
                <span key={key} className={cx('s')}>{key} <b>{rates[key] != null ? pc(rates[key]) : '—'}</b></span>
              ))}
              <span className={cx('s', 'stdNote')}>From Apr–Sep 2026, all dealers · reviewed yearly</span>
            </div>

            <div className={cx('kpis')}>
              <div className={cx('k', 'kMain')}>
                <div className={cx('lab')}>All dealers — VDP views</div>
                <div className={cx('v', tone(pctChange(T0, T1)))}>{sg(pctChange(T0, T1), 1)}%</div>
                <div className={cx('d')}>
                  {fmt(T1)} vs {fmt(T0)}
                  {comparable.length < dealers.length ? ` · ${comparable.length} of ${dealers.length} dealers have VDP in both periods` : ''}
                </div>
              </div>
              <div className={cx('k')}>
                <div className={cx('lab')}>All dealers — in-stock units</div>
                <div className={cx('v', tone(pctChange(I0, I1)))}>{stocked.length ? `${sg(pctChange(I0, I1), 1)}%` : '—'}</div>
                <div className={cx('d')}>{stocked.length ? `${fmt(I1)} vs ${fmt(I0)} (avg. per day, ${stocked.length} dealers)` : 'No feed snapshots for these dates'}</div>
              </div>
              <div className={cx('k')}>
                <div className={cx('lab')}>Dealers shown</div>
                <div className={cx('v')}>{fmt(summaryRows.length)}</div>
                <div className={cx('d')}>
                  of {base.length} · {on === 'vdp' ? 'VDP' : 'real'} change{' '}
                  {thr
                    ? `${dir === 'both' ? '±' : dir === 'down' ? '−' : '+'}${thr}%+`
                    : dir === 'both' ? 'any size' : dir === 'down' ? 'down, any size' : 'up, any size'}
                  {noTraffic > 0 ? ` · ${noTraffic} without GA4 traffic` : ''}
                </div>
              </div>
            </div>

            <section className={cx('card', 'cardMenus')}>
              <div className={cx('cardHead')}>
                <div>
                  <h2>Real change summary</h2>
                  <p>Real change % after removing what users, sessions per user and pages per session explain. Red cells are the real problems.</p>
                </div>
                <div className={cx('cardTools')}>
                  <FilterDropdown multi clearable options={dealerOptions} value={pickedDealers} onChange={pickDealers} />
                  <span className={cx('lab')}>Flag real drop of</span>
                  <Seg label="Flag real drop of" value={flag} onChange={setFlag} options={FLAGS.map((f) => [f, `${f}%`])} />
                  <Seg label="Dealers" value={onlyFlagged} onChange={setOnlyFlagged} options={[[true, 'Flagged dealers'], [false, 'All dealers']]} />
                </div>
              </div>
              <div
                ref={summaryScrollRef}
                className={cx('tw', 'sumScroll')}
                style={summaryBox ?? undefined}
              >
                <table className={cx('sumt')}>
                  <thead>
                    <tr>
                      <th>Dealer</th>
                      <th>VDP change</th>
                      <th className={cx('tt')}>Real change<br />total</th>
                      {CHANNELS.map(({ key }) => <th key={key}>{key}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className={cx('cnt')}>
                      <td>Dealers with a real drop of {flag}%+</td>
                      <td />
                      <td className={cx('tt')}>{flagCount('T')} of {base.length}</td>
                      {CHANNELS.map(({ key }) => <td key={key}>{flagCount(key)}</td>)}
                    </tr>
                    {summaryRows.map((d) => (
                      <tr
                        key={d.clientId}
                        className={cx('dr')}
                        onClick={() => openWorksheet(d.clientId)}
                      >
                        <td>
                          <b>{d.name}</b>
                          <small>{fmt(d.W.v0)} → {fmt(d.W.v1)} VDP</small>
                        </td>
                        <td className={cx(tone(d.W.diffPct))}>{sg(d.W.diffPct, 1)}%</td>
                        {summaryCell(d.W, 'total', true)}
                        {CHANNELS.map(({ key }) => summaryCell(d.CW[key], key))}
                      </tr>
                    ))}
                    {!summaryRows.length && (
                      <tr>
                        <td colSpan={CHANNELS.length + 3} className={cx('none')}>
                          {picked.size ? 'None of the selected dealers match these filters.' : 'No dealers match these filters.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <p className={cx('foot')}>
                Each cell is that channel&apos;s real change % against its own last-period VDP; the Total column is the dealer&apos;s overall real change.
                &quot;—&quot; means under {MIN_CHANNEL_VDP} VDP views last period, too small to read. Click a dealer to open its worksheet.
              </p>
            </section>

            <h2 className={cx('listTitle')}>Dealer worksheets</h2>
            {!openDealers.length && (
              <div className={cx('empty')}>Click a dealer in the table above, or use Expand all, to open its worksheet here.</div>
            )}
            {openDealers.map((d) => {
              const ic = pctChange(d.inv0, d.inv1);
              const expanded = isExpanded(d.clientId);
              return (
                <section key={d.clientId} id={`vdpc-${d.clientId}`} className={cx('dealer', expanded && 'open')} aria-label={`${d.name} worksheet`}>
                  <button type="button" className={cx('dh')} onClick={() => toggleWorksheet(d.clientId)} aria-expanded={expanded}>
                    <div className={cx('nm')}>
                      {d.name}
                      <div className={cx('inv')}>
                        {d.inv0 != null && d.inv1 != null
                          ? <>In stock {fmt(d.inv0)} → {fmt(d.inv1)} (<span className={cx(tone(ic))}>{sg(ic)}%</span>)</>
                          : 'In stock —'}
                      </div>
                    </div>
                    <div className={cx('m')}><div className={cx('lab')}>VDP views</div><div className={cx('mv')}>{fmt(d.W.v0)} → {fmt(d.W.v1)}</div></div>
                    <div className={cx('m')}><div className={cx('lab')}>VDP change</div><div className={cx('mv')}><b className={cx(tone(d.W.diff))}>{sg(d.W.diffPct, 1)}%</b> {sg(d.W.diff)}</div></div>
                    <div className={cx('m')}><div className={cx('lab')}>Explained by traffic</div><div className={cx('mv')}><b className={cx(tone(d.W.traffic))}>{sg(d.W.trafficPct, 1)}%</b> {sg(d.W.traffic)}</div></div>
                    <div className={cx('m', 'mRem')}><div className={cx('lab')}>Real change</div><div className={cx('mv')}><b className={cx(tone(d.W.real))}>{sg(d.W.realPct, 1)}%</b> {sg(d.W.real)}</div></div>
                    <span className={cx('caret')} aria-hidden>›</span>
                  </button>
                  {expanded && (
                    <div className={cx('body')}>
                      <Worksheet
                        d={d}
                        lab0={lab0}
                        lab1={lab1}
                        sel={chSel[d.clientId] || 'all'}
                        onSelect={(k) => setChSel((s) => ({ ...s, [d.clientId]: k }))}
                      />
                    </div>
                  )}
                </section>
              );
            })}

            <section className={cx('card')}>
              <div className={cx('notes')}>
                <b>How it works.</b> Section 1 is the VDP change (Final VDP views, the same rules as Overview). Section 2 rebuilds VDP from traffic:
                {' '}Users × Sessions per user × Pages per session × the channel&apos;s standard VDP rate, for both periods, and takes the % change.
                {' '}That % is applied to last period&apos;s actual VDP to get the views traffic explains. Section 3 subtracts it: whatever is left is
                {' '}the real change, which you look for in Google Ads / Meta (paid) or on the site.<br />
                <b>Why the standard rates don&apos;t distort anything.</b> The same rate is used in both periods, so it cancels out of the % change in step J.
                {' '}A dealer whose real rate is higher or lower than the standard gets the same answer, which is why step K applies the % to actual VDP
                {' '}instead of subtracting the estimated views directly.<br />
                <b>Dates.</b> Data runs through two days ago, because GA4&apos;s last two days aren&apos;t final. Both periods cover the same days of the month.
                {' '}In-stock units are the average per day from the feed&apos;s daily snapshots. PMax is GA4&apos;s Cross-network channel.
                {noTraffic > 0 ? ` ${noTraffic} dealer(s) are left out because GA4 traffic couldn't be read for these dates.` : ''}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

