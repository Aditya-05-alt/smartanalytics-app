'use client';

import { useRef, useState } from 'react';
import { balance, canonLine, combineReports, endLabel, mkey, mv, qv, slug, sortEnds, sortQ, totals } from '@/lib/wheelerPump/calc';
import { deleteGroup, extractReport, reportFileUrl, saveReview, uploadReportFile } from '@/lib/wheelerPump/data';
import { downloadText, parseSheetFile, toCsv } from '@/lib/wheelerPump/sheets';
import { Card, cx, useDash } from '../ui';

const SUMCOLS = [
  ['Quarter', 'quarter'], ['Location', 'location'], ['Brand', 'brand'], ['Product line', 'line'],
  ['Local sales', 'local'], ['Pumped in', 'pin'], ['Pumped out', 'pout'], ['Source / notes', 'source'],
];
const emptyReview = () => ({
  sum: [], dl: [], rsum: [], rdl: [], msum: [], mdl: [], warn: [], skipped: [], files: [],
  raw: { sum: [], dl: [], rsum: [], rdl: [], msum: [], mdl: [] },
  fileWarn: [],
});
const rowCount = (rev) => rev.sum.length + rev.rsum.length + rev.msum.length;

const PDF_EXT = ['pdf', 'png', 'jpg', 'jpeg'];
const extOf = (file) => (file.name.split('.').pop() || '').toLowerCase();

/** Recent calendar quarters and month-ends, newest first, defaulting to the last completed one. */
function periodChoices() {
  const now = new Date();
  const lastMonth = now.getFullYear() * 12 + now.getMonth() - 1;
  const ends = Array.from({ length: 24 }, (_, i) => mkey(lastMonth - i));
  const lastQ = Math.floor((lastMonth + 1) / 3) - 1;
  const quarters = Array.from({ length: 12 }, (_, i) => {
    const v = lastQ - i;
    return `Q${(v % 4) + 1} ${Math.floor(v / 4)}`;
  });
  return { ends, quarters };
}

/** The uploader's answer wins over Claude's guess; a mismatch is flagged for review. */
function applyPeriodChoice(r, choice, fileName, warn) {
  if (!choice || choice.type === 'auto') return r;
  const read = r.periodType === 'r12'
    ? `rolling 12 months to ${endLabel(r.periodEnd)}`
    : r.quarter || 'no clear period';
  if (choice.type === 'm') {
    warn.push(`${fileName}: marked as the month of ${endLabel(choice.month)}${r.periodType === 'r12' || r.quarter ? `, but Claude read it as ${read}` : ''}. Check the numbers are for that month only.`);
    return { ...r, periodType: 'month', month: choice.month };
  }
  if (choice.type === 'q') {
    if (r.periodType === 'r12' || (r.quarter && r.quarter !== choice.quarter)) {
      warn.push(`${fileName}: marked as quarterly ${choice.quarter}, but Claude read it as ${read}. Check the numbers are for that quarter only.`);
    }
    return { ...r, periodType: 'quarter', quarter: choice.quarter };
  }
  if (r.periodType !== 'r12' || r.periodEnd !== choice.end) {
    warn.push(`${fileName}: marked as rolling 12 months to ${endLabel(choice.end)}, but Claude read it as ${read}. Check the numbers cover those 12 months.`);
  }
  return { ...r, periodType: 'r12', periodEnd: choice.end, periodStart: mkey(mv(choice.end) - 11) };
}

const DATA_KINDS = [
  {
    id: 'oem_pdf',
    title: 'OEM PDF / scan',
    text: 'Polaris, Honda, Yamaha, Suzuki, BRP, Kawasaki PDFs or photos of printed reports.',
  },
  {
    id: 'excel_csv',
    title: 'Excel or CSV',
    text: 'Structured tables (.xlsx, .xls, .xlsm, .csv, .tsv) — pump tracker or any tabular export.',
  },
  {
    id: 'gsheet',
    title: 'Google Sheets export',
    text: 'Download the sheet as Excel or CSV first, then upload that file here.',
  },
  {
    id: 'unstructured',
    title: 'Other / unstructured',
    text: 'Notes, mixed docs, screenshots, or anything without a clean table. Claude will still try to pull usable numbers.',
  },
  {
    id: 'mixed',
    title: 'Mixed batch',
    text: 'Several formats in one drop. Claude reads each file on its own.',
  },
];

/** Asked before Claude reads anything: what data is this, and what period does it cover? */
function AnalysisDataPrompt({ files, onConfirm, onCancel }) {
  const { ends, quarters } = periodChoices();
  const [dataKind, setDataKind] = useState(() => {
    const exts = files.map(extOf);
    const hasPdf = exts.some((e) => PDF_EXT.includes(e));
    const hasSheet = exts.some((e) => ['csv', 'xlsx', 'xls', 'xlsm', 'tsv'].includes(e));
    if (hasPdf && hasSheet) return 'mixed';
    if (hasSheet) return 'excel_csv';
    if (hasPdf) return 'oem_pdf';
    return 'unstructured';
  });
  const [type, setType] = useState('auto');
  const [quarter, setQuarter] = useState(quarters[0]);
  const [end, setEnd] = useState(ends[0]);
  const [month, setMonth] = useState(ends[0]);
  const names = files.slice(0, 4).map((f) => f.name).join(', ');
  const kindOption = (value, title, text) => (
    <label className={cx('periodOption', dataKind === value && 'periodOptionOn')}>
      <input type="radio" name="wpDataKind" value={value} checked={dataKind === value} onChange={() => setDataKind(value)} />
      <span className={cx('periodOptionBody')}>
        <b>{title}</b>
        <span className={cx('status')}>{text}</span>
      </span>
    </label>
  );
  const periodOption = (value, title, text, control) => (
    <label className={cx('periodOption', type === value && 'periodOptionOn')}>
      <input type="radio" name="wpPeriodType" value={value} checked={type === value} onChange={() => setType(value)} />
      <span className={cx('periodOptionBody')}>
        <b>{title}</b>
        <span className={cx('status')}>{text}</span>
        {type === value && control}
      </span>
    </label>
  );
  const confirm = () => {
    const period = { q: { type, quarter }, r12: { type, end }, m: { type, month } }[type] ?? { type };
    onConfirm({ ...period, dataKind });
  };
  return (
    <div className={cx('overlay')} onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className={cx('sheet', 'analysisSheet')} role="dialog" aria-modal="true" aria-labelledby="wpAnalysisTitle">
        <div className={cx('cardhead')}>
          <div>
            <h3 id="wpAnalysisTitle">What data are you including for analysis?</h3>
            <p className={cx('sub')}>
              Claude can read monthly or quarterly OEM reports, Excel/CSV, Google Sheets exports, and unstructured files.
              {' '}{files.length} file{files.length === 1 ? '' : 's'}: {names}
              {files.length > 4 ? ` and ${files.length - 4} more` : ''}.
            </p>
          </div>
          <button className={cx('btn', 'ghost')} type="button" onClick={onCancel}>Cancel</button>
        </div>

        <p className={cx('promptSection')}>1. Data you are uploading</p>
        <div className={cx('periodOptions')}>
          {DATA_KINDS.map((k) => kindOption(k.id, k.title, k.text))}
        </div>

        <p className={cx('promptSection')}>2. Period these numbers cover</p>
        <div className={cx('periodOptions')}>
          {periodOption('m', 'Monthly', 'One calendar month. Feeds monthly views and the month-by-month trend.', (
            <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month">
              {ends.map((x) => <option key={x} value={x}>{endLabel(x)}</option>)}
            </select>
          ))}
          {periodOption('q', 'Quarterly', 'One calendar quarter (3 months). Feeds the quarterly views.', (
            <select value={quarter} onChange={(e) => setQuarter(e.target.value)} aria-label="Quarter">
              {quarters.map((x) => <option key={x}>{x}</option>)}
            </select>
          ))}
          {periodOption('r12', 'Rolling 12 months', 'A 12-month window. Feeds the Rolling 12 months tab.', (
            <select value={end} onChange={(e) => setEnd(e.target.value)} aria-label="Window ends">
              {ends.map((x) => (
                <option key={x} value={x}>{`${endLabel(mkey(mv(x) - 11))} – ${endLabel(x)}`}</option>
              ))}
            </select>
          ))}
          {periodOption('auto', 'Let Claude decide', 'Claude reads dates and structure from each file — best for mixed or unfamiliar layouts.', null)}
        </div>

        <div className={cx('actions')}>
          <button className={cx('btn', 'primary')} type="button" onClick={confirm}>
            Analyze {files.length} file{files.length === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Rebuild the review rows from every file read so far: merge overlapping reports, then balance dealers. */
function finalizeReview(rev) {
  const q = combineReports(rev.raw.sum, rev.raw.dl, 'quarter');
  const r12 = combineReports(rev.raw.rsum, rev.raw.rdl, 'end');
  const mo = combineReports(rev.raw.msum, rev.raw.mdl, 'month');
  const warn = [...rev.fileWarn];
  balance(q.sum, q.dl, warn, 'quarter');
  balance(r12.sum, r12.dl, warn, 'end');
  balance(mo.sum, mo.dl, warn, 'month');
  return { ...rev, sum: q.sum, dl: q.dl, rsum: r12.sum, rdl: r12.dl, msum: mo.sum, mdl: mo.dl, warn };
}

/** Editable review cell: edits the row object in place (saved as-is). */
function EditCell({ row, field, wide = false }) {
  return (
    <input
      className={cx('cell', wide && 'wide')}
      type={wide ? 'text' : 'number'}
      defaultValue={String(row[field] ?? '')}
      aria-label={field}
      onChange={(e) => { row[field] = wide ? e.target.value.trim() : Number(e.target.value) || 0; }}
    />
  );
}

function CellSheet({ kind, per, l, b, onClose }) {
  const { client, data, isWheeler, reload, toast } = useDash();
  const at = (r) => r.location === l && r.brand === b;
  const rs = {
    q: () => data.q.filter((r) => !r.calc && r.quarter === per && at(r)),
    r: () => data.r.filter((r) => r.end === per && at(r)),
    m: () => data.m.filter((r) => r.month === per && at(r)),
  }[kind]();
  const dealerRows = {
    q: () => data.qd.filter((r) => r.quarter === per && at(r)),
    r: () => data.rd.filter((r) => r.end === per && at(r)),
    m: () => data.md.filter((r) => r.month === per && at(r)),
  }[kind]().length;
  const label = { q: per, r: `rolling 12 to ${endLabel(per)}`, m: endLabel(per) }[kind];
  const [armed, setArmed] = useState(false);
  const [err, setErr] = useState('');
  const remove = async () => {
    if (!armed) { setArmed(true); return; }
    try {
      await deleteGroup(client.id, kind, per, l, b);
      toast('Removed');
      await reload();
      onClose();
    } catch (error) {
      setErr(`Couldn't remove: ${error.message}`);
    }
  };
  return (
    <div className={cx('overlay')} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cx('sheet')} role="dialog" aria-modal="true">
        <div className={cx('cardhead')}>
          <h3>{l} · {b} · {label}</h3>
          <button className={cx('btn', 'ghost')} type="button" onClick={onClose}>Close</button>
        </div>
        <div className={cx('tblWrap')}>
          <table>
            <thead><tr>{['Line', 'Local', 'In', 'Out'].map((x) => <th key={x}>{x}</th>)}</tr></thead>
            <tbody>
              {rs.map((r) => (
                <tr key={r.line}>
                  <td className={cx('txt')}>{r.line}</td><td>{r.local}</td><td>{r.pin}</td><td>{r.pout}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={cx('status')}>Source: {[...new Set(rs.map((r) => r.source))].join('; ')}</p>
        <p className={cx('status')}>{dealerRows} dealer/market rows.</p>
        {isWheeler && (
          <div>
            <button className={cx('btn', 'danger')} type="button" onClick={remove}>
              {armed ? 'Click again to remove' : `Remove ${b} ${label} from ${l}`}
            </button>
            {err && <p className={cx('status', 'err')}>{err}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

export default function UploadTab() {
  const { client, data, loc, isWheeler, reload, toast } = useDash();
  const locs = client.locations?.length ? client.locations : [...new Set(data.q.map((r) => r.location))];
  const [upLoc, setUpLoc] = useState(loc === 'All' ? locs[0] : loc);
  const [review, setReview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);
  const [over, setOver] = useState(false);
  const [cell, setCell] = useState(null);
  const [pending, setPending] = useState(null);
  const [, force] = useState(0);
  const input = useRef(null);

  /** Ask what data / period before Claude (or the sheet parser) runs. */
  function pickFiles(files) {
    if (busy || !files.length) return;
    setPending(files);
    if (input.current) input.current.value = '';
  }

  async function handleFiles(files, choice) {
    if (busy || !files.length) return;
    setBusy(true);
    const rev = review ?? emptyReview();
    const { raw } = rev;
    try {
      for (const file of files) {
        const ext = extOf(file);
        if (PDF_EXT.includes(ext)) {
          setStatus({ msg: `${file.name}: uploading…` });
          const path = await uploadReportFile(client.id, file);
          const kindLabel = {
            oem_pdf: 'OEM PDF',
            excel_csv: 'Excel/CSV',
            gsheet: 'Google Sheets export',
            unstructured: 'unstructured file',
            mixed: 'mixed upload',
          }[choice?.dataKind] || 'report';
          setStatus({ msg: `${file.name}: Claude is analyzing this ${kindLabel} (this can take a minute)…` });
          const res = await extractReport(client.id, upLoc, path, file.name);
          for (const read of res.results ?? []) {
            const r = applyPeriodChoice(read, choice, file.name, rev.fileWarn);
            const brand = String(r.brand || '').trim();
            const src = `${[r.report, r.period].filter(Boolean).join(', ')} · ${file.name}`;
            const lineOf = (s) => canonLine(s.line, `${r.report ?? ''} ${file.name}`);
            const lines = [...new Set((r.summary ?? []).map(lineOf))].sort().join(',');
            const dealerRow = (d, period) => ({
              ...period, location: upLoc, brand, dir: /^o/i.test(d.direction) ? 'Out' : 'In',
              name: String(d.name || '').trim() || 'Other', units: +d.units || 0, file: file.name, lines,
            });
            if (r.periodType === 'month') {
              for (const s of r.summary ?? []) {
                raw.msum.push({ month: r.month, location: upLoc, brand, line: lineOf(s), local: +s.local || 0, pin: +s.pumpedIn || 0, pout: +s.pumpedOut || 0, source: src });
              }
              for (const d of r.dealers ?? []) raw.mdl.push(dealerRow(d, { month: r.month }));
              continue;
            }
            if (r.periodType === 'r12') {
              if (mv(r.periodEnd) == null) {
                rev.fileWarn.push(`${file.name}: a rolling 12-month result had no end month and was left out.`);
                continue;
              }
              const st = mv(r.periodStart) != null ? r.periodStart : mkey(mv(r.periodEnd) - 11);
              for (const s of r.summary ?? []) {
                raw.rsum.push({ end: r.periodEnd, start: st, location: upLoc, brand, line: lineOf(s), local: +s.local || 0, pin: +s.pumpedIn || 0, pout: +s.pumpedOut || 0, source: src });
              }
              for (const d of r.dealers ?? []) raw.rdl.push(dealerRow(d, { end: r.periodEnd }));
              continue;
            }
            if (qv(r.quarter) == null) {
              rev.fileWarn.push(`${file.name}: a result had no calendar quarter and was left out.`);
              continue;
            }
            for (const s of r.summary ?? []) {
              raw.sum.push({ quarter: r.quarter, location: upLoc, brand, line: lineOf(s), local: +s.local || 0, pin: +s.pumpedIn || 0, pout: +s.pumpedOut || 0, source: src });
            }
            for (const d of r.dealers ?? []) raw.dl.push(dealerRow(d, { quarter: r.quarter }));
          }
          for (const s of res.skipped ?? []) rev.skipped.push(`${file.name}: ${s.brand ? `${s.brand} – ` : ''}${s.reason}`);
          for (const w of res.warnings ?? []) rev.fileWarn.push(`${file.name}: ${w}`);
          rev.files.push({ name: file.name, path });
        } else if (['csv', 'xlsx', 'xls', 'xlsm', 'tsv'].includes(ext)) {
          setStatus({ msg: `${file.name}: reading spreadsheet…` });
          const parsed = await parseSheetFile(await file.arrayBuffer(), ext, upLoc);
          raw.sum.push(...parsed.sum);
          raw.dl.push(...parsed.dl.map((d) => ({ ...d, file: file.name })));
          raw.rsum.push(...parsed.rsum);
          raw.rdl.push(...parsed.rdl.map((d) => ({ ...d, file: file.name })));
          rev.fileWarn.push(...parsed.warn.map((w) => `${file.name}: ${w}`));
          rev.files.push({ name: file.name, path: '' });
        } else {
          rev.fileWarn.push(`${file.name}: not a PDF, image, CSV or Excel file, so it was skipped.`);
        }
      }
      const done = finalizeReview(rev);
      setReview(done);
      setStatus({
        msg: rowCount(done)
          ? 'Review the rows below, fix anything that looks off, then save.'
          : 'Nothing to save from these files. See the notes below.',
      });
    } catch (error) {
      const partial = finalizeReview(rev);
      if (rowCount(partial)) setReview(partial);
      setStatus({ msg: error.message || 'Something went wrong reading the file.', err: true });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  async function save() {
    if (!review) return;
    setBusy(true);
    setStatus({ msg: 'Saving…' });
    try {
      await saveReview(client.id, review);
      toast(`Saved ${rowCount(review)} rows`);
      setReview(null);
      setStatus(null);
      await reload();
    } catch (error) {
      setStatus({ msg: `Couldn't save: ${error.message}`, err: true });
    }
    setBusy(false);
  }

  const sumReal = data.q.filter((r) => !r.calc);
  const qs = sortQ(sumReal.map((r) => r.quarter));
  const ends = sortEnds(data.r.map((r) => r.end));
  const months = sortEnds(data.m.map((r) => r.month));

  const covTable = (kind, cols, label) => {
    const src = { q: sumReal, r: data.r, m: data.m }[kind];
    const pairs = [...new Set(src.map((r) => `${r.location}|${r.brand}`))].sort();
    if (!pairs.length) return <p className={cx('empty')}>Nothing loaded yet.</p>;
    const per = (r) => r.quarter ?? r.month ?? r.end;
    return (
      <div className={cx('tblWrap')}>
        <table className={cx('cov')}>
          <thead>
            <tr><th>Store · brand</th>{cols.map((c) => <th key={c} style={{ textAlign: 'center' }}>{label(c)}</th>)}</tr>
          </thead>
          <tbody>
            {pairs.map((p) => {
              const [l, b] = p.split('|');
              return (
                <tr key={p}>
                  <td className={cx('txt')}>{l} · {b}</td>
                  {cols.map((c) => {
                    const rs = src.filter((r) => r.location === l && r.brand === b && per(r) === c);
                    return (
                      <td key={c}>
                        {rs.length
                          ? <button type="button" title="View or remove" onClick={() => setCell({ kind, per: c, l, b })}>{totals(rs).pin} in</button>
                          : <span className={cx('no')}>–</span>}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  const removeRow = (list, index) => {
    list.splice(index, 1);
    force((x) => x + 1);
  };

  return (
    <div className={cx('stack')}>
      {review && (
        <Card
          style={{ borderColor: 'var(--accent)' }}
          title="Review before saving"
          sub={`${rowCount(review)} product-line rows and ${review.dl.length + review.rdl.length + review.mdl.length} dealer/market rows. Saving replaces any existing rows for the same period, store and brand.`}
          action={(
            <div style={{ display: 'flex', gap: 8 }}>
              <button className={cx('btn')} type="button" onClick={() => { setReview(null); setStatus(null); }}>Discard</button>
              <button className={cx('btn', 'primary')} type="button" disabled={busy || !rowCount(review)} onClick={save}>
                Save to dashboard
              </button>
            </div>
          )}
        >
          {rowCount(review) > 0 && (
            <div className={cx('banner', 'bannerAccent')} style={{ marginBottom: 10 }}>
              <b>Report type detected: </b>
              <ul className={cx('bannerList')}>
                {[...new Set([
                  ...review.msum.map((r) => `${r.location} · ${r.brand} · monthly ${endLabel(r.month)}`),
                  ...review.sum.map((r) => `${r.location} · ${r.brand} · quarterly ${r.quarter}`),
                  ...review.rsum.map((r) => `${r.location} · ${r.brand} · rolling 12 months ${endLabel(r.start)} – ${endLabel(r.end)}`),
                ])].map((s) => <li key={s}>{s}</li>)}
              </ul>
              <div className={cx('status')} style={{ marginTop: 4 }}>
                Monthly and quarterly reports go to the matching Period in Overview, Brands and Dealers. Rolling 12-month reports also feed the Rolling 12 months tab.
              </div>
            </div>
          )}
          {review.skipped.length > 0 && (
            <div className={cx('banner')} style={{ marginBottom: 10 }}>
              <b>Not loaded: </b>
              <ul className={cx('bannerList')}>{review.skipped.map((s, i) => <li key={i}>{s}</li>)}</ul>
            </div>
          )}
          {review.warn.length > 0 && (
            <div className={cx('banner')} style={{ marginBottom: 10 }}>
              <b>Check: </b>
              <ul className={cx('bannerList')}>{review.warn.map((s, i) => <li key={i}>{s}</li>)}</ul>
            </div>
          )}
          {review.msum.length > 0 && (
            <>
              <h2 className={cx('sectionTitle')}>Monthly rows ({review.msum.length})</h2>
              <div className={cx('tblWrap')}>
                <table>
                  <thead>
                    <tr>{['Month', 'Store', 'Brand', 'Line', 'Local', 'Pumped in', 'Pumped out', 'Source', ''].map((x) => <th key={x}>{x}</th>)}</tr>
                  </thead>
                  <tbody>
                    {review.msum.map((r, i) => (
                      <tr key={i + r.month + r.brand + r.line}>
                        <td className={cx('txt')}>{endLabel(r.month)}</td>
                        <td className={cx('txt')}>{r.location}</td>
                        <td className={cx('txt')}>{r.brand}</td>
                        <td className={cx('txt')}>{r.line}</td>
                        <td><EditCell row={r} field="local" /></td>
                        <td><EditCell row={r} field="pin" /></td>
                        <td><EditCell row={r} field="pout" /></td>
                        <td className={cx('txt', 'status')} style={{ maxWidth: 260 }}>{r.source}</td>
                        <td>
                          <button className={cx('btn', 'ghost')} type="button" aria-label="Remove row" onClick={() => removeRow(review.msum, i)}>×</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {review.sum.length > 0 && (
            <>
              <h2 className={cx('sectionTitle')}>Quarterly rows ({review.sum.length})</h2>
              <div className={cx('tblWrap')}>
                <table>
                  <thead>
                    <tr>{['Quarter', 'Store', 'Brand', 'Line', 'Local', 'Pumped in', 'Pumped out', 'Source', ''].map((x) => <th key={x}>{x}</th>)}</tr>
                  </thead>
                  <tbody>
                    {review.sum.map((r, i) => (
                      <tr key={i + r.quarter + r.brand + r.line}>
                        <td><EditCell row={r} field="quarter" wide /></td>
                        <td className={cx('txt')}>{r.location}</td>
                        <td className={cx('txt')}>{r.brand}</td>
                        <td className={cx('txt')}>{r.line}</td>
                        <td><EditCell row={r} field="local" /></td>
                        <td><EditCell row={r} field="pin" /></td>
                        <td><EditCell row={r} field="pout" /></td>
                        <td className={cx('txt', 'status')} style={{ maxWidth: 260 }}>{r.source}</td>
                        <td>
                          <button className={cx('btn', 'ghost')} type="button" aria-label="Remove row" onClick={() => removeRow(review.sum, i)}>×</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {review.rsum.length > 0 && (
            <>
              <h2 className={cx('sectionTitle')} style={{ marginTop: 14 }}>Rolling 12-month rows ({review.rsum.length})</h2>
              <div className={cx('tblWrap')}>
                <table>
                  <thead>
                    <tr>{['Window', 'Store', 'Brand', 'Line', 'Local', 'Pumped in', 'Pumped out', 'Source', ''].map((x) => <th key={x}>{x}</th>)}</tr>
                  </thead>
                  <tbody>
                    {review.rsum.map((r, i) => (
                      <tr key={i + r.end + r.brand + r.line}>
                        <td className={cx('txt')}>{endLabel(r.start)} – {endLabel(r.end)}</td>
                        <td className={cx('txt')}>{r.location}</td>
                        <td className={cx('txt')}>{r.brand}</td>
                        <td className={cx('txt')}>{r.line}</td>
                        <td><EditCell row={r} field="local" /></td>
                        <td><EditCell row={r} field="pin" /></td>
                        <td><EditCell row={r} field="pout" /></td>
                        <td className={cx('txt', 'status')} style={{ maxWidth: 260 }}>{r.source}</td>
                        <td>
                          <button className={cx('btn', 'ghost')} type="button" aria-label="Remove row" onClick={() => removeRow(review.rsum, i)}>×</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <details style={{ marginTop: 10 }}>
            <summary className={cx('status')} style={{ cursor: 'pointer' }}>Dealer and market rows ({review.dl.length + review.rdl.length + review.mdl.length})</summary>
            <div className={cx('tblWrap')}>
              <table>
                <thead>
                  <tr>{['Period', 'Store', 'Brand', 'In/Out', 'Dealer or market', 'Units'].map((x) => <th key={x}>{x}</th>)}</tr>
                </thead>
                <tbody>
                  {[...review.mdl, ...review.dl, ...review.rdl].map((d, i) => (
                    <tr key={i}>
                      <td>{'quarter' in d ? d.quarter : 'month' in d ? endLabel(d.month) : `R12 to ${endLabel(d.end)}`}</td>
                      <td className={cx('txt')}>{d.location}</td>
                      <td className={cx('txt')}>{d.brand}</td>
                      <td className={cx('txt')}>{d.dir}</td>
                      <td className={cx('txt')}><EditCell row={d} field="name" wide /></td>
                      <td><EditCell row={d} field="units" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </Card>
      )}

      <Card title="Upload new reports" sub="One store at a time. Tell Claude what you are including — monthly, quarterly, Excel/CSV, Google Sheets, or unstructured — then review and save.">
        <div className={cx('steps')}>
          <div><b>Upload</b>Any structured or unstructured report for one store. You&apos;ll choose the data type and period before analysis.</div>
          <div><b>Review</b>Check the numbers and anything Claude couldn&apos;t use.</div>
          <div><b>Save</b>Each period becomes a point on the timeline in Overview, Brands and Dealers.</div>
        </div>
        {isWheeler ? (
          <div
            className={cx('drop', over && 'over')}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); pickFiles([...e.dataTransfer.files]); }}
          >
            <b>Drop files for analysis</b>
            <span className={cx('status')}>OEM PDFs, Excel/CSV, Google Sheets exports, screenshots, or mixed batches — Claude can analyze structured or unstructured data</span>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center', alignItems: 'flex-end' }}>
              <div className={cx('field')}>
                <label htmlFor="wpUpLoc">Store these reports are for</label>
                <select id="wpUpLoc" value={upLoc} onChange={(e) => setUpLoc(e.target.value)}>
                  {locs.map((l) => <option key={l}>{l}</option>)}
                </select>
              </div>
              <button className={cx('btn', 'primary')} type="button" disabled={busy} onClick={() => input.current?.click()}>
                {busy ? 'Reading…' : 'Choose files'}
              </button>
            </div>
            <input
              ref={input}
              type="file"
              multiple
              hidden
              accept=".pdf,.png,.jpg,.jpeg,.csv,.xlsx,.xls,.xlsm,.tsv"
              onChange={(e) => pickFiles([...(e.target.files ?? [])])}
            />
          </div>
        ) : <p className={cx('empty')}>Your Wheeler team uploads new reports.</p>}
        {status && <p className={cx('status', status.err && 'err')}>{status.msg}</p>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <button
            className={cx('btn')}
            type="button"
            onClick={() => downloadText('pump-tracker-template.csv', toCsv([
              { quarter: 'Q3 2026', location: locs[0] || 'Store', brand: 'Polaris', line: 'Ranger', local: 14, pin: 12, pout: 6, source: 'Quarterly example' },
              { quarter: 'R12 2026-09', location: locs[0] || 'Store', brand: 'Honda', line: 'All', local: 50, pin: 60, pout: 80, source: 'Rolling 12 example: Oct 2025–Sep 2026' },
            ], SUMCOLS))}
          >
            Download CSV template
          </button>
          <button
            className={cx('btn')}
            type="button"
            disabled={!sumReal.length}
            onClick={() => downloadText(`${slug(client.name)}-pump-quarterly.csv`, toCsv(sumReal, SUMCOLS))}
          >
            Export quarterly CSV
          </button>
          <button
            className={cx('btn')}
            type="button"
            disabled={!data.r.length}
            onClick={() => downloadText(`${slug(client.name)}-pump-rolling12.csv`, toCsv(data.r.map((r) => ({ ...r, quarter: `R12 ${r.end}` })), SUMCOLS))}
          >
            Export rolling 12 CSV
          </button>
        </div>
      </Card>

      <Card title="What's loaded" sub="Pumped-in units per store, brand and period. A dash means nothing is loaded. Click a cell to see its source or remove it.">
        <h2 className={cx('sectionTitle')}>Monthly reports</h2>
        {covTable('m', months, endLabel)}
        <h2 className={cx('sectionTitle')} style={{ marginTop: 16 }}>Quarterly reports</h2>
        {covTable('q', qs, (c) => c)}
        <h2 className={cx('sectionTitle')} style={{ marginTop: 16 }}>Rolling 12-month reports (by month the window ends)</h2>
        {covTable('r', ends, endLabel)}
      </Card>

      <Card title="Upload history">
        {data.uploads.length ? (
          <div className={cx('log')}>
            {data.uploads.map((u) => (
              <div key={u.id}>
                <div>
                  <b>{u.label || 'Upload'}</b>
                  {' · '}
                  {new Date(u.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  {` · ${u.row_count} rows`}
                  {u.months?.length ? ` · ${u.months.map(endLabel).join(', ')}` : ''}
                  {u.quarters?.length ? ` · ${u.quarters.join(', ')}` : ''}
                  {u.r12_ends?.length ? ` · rolling 12 to ${u.r12_ends.map(endLabel).join(', ')}` : ''}
                  {u.brands?.length ? ` · ${u.brands.join(', ')}` : ''}
                </div>
                {u.files?.length > 0 && (
                  <div className={cx('status')}>
                    {u.files.map((f, i) => (
                      <span key={i}>
                        {i ? ', ' : ''}
                        {f.path ? (
                          <a
                            href="#"
                            onClick={async (e) => {
                              e.preventDefault();
                              const url = await reportFileUrl(f.path);
                              if (url) window.open(url, '_blank', 'noopener');
                            }}
                          >
                            {f.name}
                          </a>
                        ) : f.name}
                      </span>
                    ))}
                  </div>
                )}
                {u.skipped?.length > 0 && (
                  <details>
                    <summary className={cx('status')} style={{ cursor: 'pointer' }}>{u.skipped.length} reports not loaded</summary>
                    <ul className={cx('status', 'bannerList')}>{u.skipped.map((s, i) => <li key={i}>{s}</li>)}</ul>
                  </details>
                )}
              </div>
            ))}
          </div>
        ) : <p className={cx('empty')}>No uploads yet.</p>}
      </Card>

      {cell && <CellSheet {...cell} onClose={() => setCell(null)} />}
      {pending && (
        <AnalysisDataPrompt
          files={pending}
          onCancel={() => setPending(null)}
          onConfirm={(choice) => {
            const files = pending;
            setPending(null);
            handleFiles(files, choice);
          }}
        />
      )}
    </div>
  );
}
