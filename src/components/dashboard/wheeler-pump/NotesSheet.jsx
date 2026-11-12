'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { notesFor, periodLabel, qv, sortQ, TAGS } from '@/lib/wheelerPump/calc';
import { addNote, deleteNote, setNoteVisibility } from '@/lib/wheelerPump/data';
import { cx, useDash } from './ui';

const STD_LINES = {
  Kawasaki: ['Motorcycle', 'ATV', 'Sport side-by-side', 'Utility side-by-side', 'Jet Ski'],
  Yamaha: ['Motorcycle', 'ATV', 'Side-by-side'],
  Honda: ['All'],
  'Can-Am': ['Side-by-side', 'ATV', 'Spyder / Ryker'],
  'Sea-Doo': ['PWC'],
  Suzuki: ['Motorcycle', 'ATV'],
  Polaris: ['ATV', 'Ranger', 'RZR', 'Xpedition', 'Youth'],
};

export function NoteCard({ n }) {
  const { isWheeler, reload, toast } = useDash();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!confirm) return undefined;
    const timer = setTimeout(() => setConfirm(false), 4000);
    return () => clearTimeout(timer);
  }, [confirm]);

  const remove = async () => {
    if (!confirm) { setConfirm(true); return; }
    setBusy(true);
    try {
      await deleteNote(n.id);
      toast('Note deleted');
      await reload();
    } catch (error) {
      toast(`Couldn't delete the note: ${error.message}`);
      setBusy(false);
    }
  };

  const flip = async () => {
    setBusy(true);
    const to = n.visibility === 'client' ? 'internal' : 'client';
    try {
      await setNoteVisibility(n.id, to);
      toast(to === 'client' ? 'The client can now see this note' : 'Now Wheeler only');
      await reload();
    } catch (error) {
      toast(`Couldn't change who can see it: ${error.message}`);
    }
    setBusy(false);
  };

  return (
    <div className={cx('noteCard')}>
      <div className={cx('meta')}>
        {isWheeler && (
          <span className={cx('pill', n.visibility === 'client' && 'pillWarn')}>
            {n.visibility === 'client' ? 'Client can see' : 'Wheeler only'}
          </span>
        )}
        {n.quarter && <span className={cx('pill')}>{periodLabel(n.quarter)}</span>}
        {n.location && <span className={cx('pill')}>{n.location}</span>}
        {n.brand && <span className={cx('pill')}>{n.brand}{n.line ? ` · ${n.line}` : ''}</span>}
        {n.model && <span className={cx('pill')}>{n.model}</span>}
        {n.dealer && <span className={cx('pill')}>{n.dealer}</span>}
        {n.tag && <span className={cx('pill', 'pillNote')}>{n.tag}</span>}
        {n.impact != null && (
          <span className={cx('pill', 'pillWarn')}>Est. {n.impact > 0 ? '+' : ''}{n.impact} units</span>
        )}
      </div>
      <div className={cx('noteText')}>{n.body}</div>
      <div className={cx('meta')}>
        {`${n.author_name || 'Wheeler team'} · ${new Date(n.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`}
        <span style={{ marginLeft: 'auto' }} />
        {isWheeler && (
          <button type="button" className={cx('btn', 'ghost', 'noteAction')} disabled={busy} onClick={flip}>
            {n.visibility === 'client' ? 'Hide from client' : 'Show to client'}
          </button>
        )}
        {isWheeler && (
          <button type="button" className={cx('btn', 'ghost', 'noteAction', confirm && 'danger')} disabled={busy} onClick={remove}>
            {confirm ? 'Confirm delete' : 'Delete'}
          </button>
        )}
      </div>
    </div>
  );
}

export function NotesSheet({ ctx, label, composeOnly = false, onClose }) {
  const { client, data, q, isWheeler, reload, toast } = useDash();
  const list = composeOnly ? [] : notesFor(data.notes, ctx);
  const locs = client.locations?.length ? client.locations : [...new Set(data.q.map((r) => r.location))];
  // Calendar quarters, plus the rolling 12-month window in view when the dashboard is in rolling mode.
  const quarters = [...new Set([
    ...sortQ([...data.q.map((r) => r.quarter), q]).reverse(),
    ...[q, ctx.quarter, ctx.quarterStrict].filter((p) => p && qv(p) == null),
  ])];
  const brands = [...new Set([...data.q.map((r) => r.brand), ...data.r.map((r) => r.brand), ...Object.keys(STD_LINES)])].sort();
  const [form, setForm] = useState({
    location: ctx.location ?? '',
    quarter: ctx.quarter ?? ctx.quarterStrict ?? (composeOnly ? q ?? '' : ''),
    brand: ctx.brand ?? '',
    line: ctx.line ?? '',
    model: '',
    dealer: ctx.dealer ?? '',
    tag: 'Inventory / stock',
    impact: '',
    visibility: 'internal',
    body: '',
  });
  const lines = useMemo(() => [...new Set(
    [...data.q, ...data.r]
      .filter((r) => !form.brand || r.brand === form.brand)
      .map((r) => r.line)
      .concat(form.brand ? STD_LINES[form.brand] ?? [] : [])
  )].sort(), [data, form.brand]);
  const dealers = useMemo(() => [...new Set([...data.qd, ...data.rd].map((d) => d.name))].sort(), [data]);
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);
  const first = useRef(null);

  useEffect(() => {
    first.current?.focus();
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value, ...(key === 'brand' ? { line: '' } : {}) });

  const save = async () => {
    if (!form.body.trim()) { setStatus({ msg: 'Write the note first.', err: true }); return; }
    setSaving(true);
    setStatus({ msg: 'Saving…' });
    try {
      await addNote({
        client_id: client.id,
        visibility: form.visibility,
        location: form.location || null,
        quarter: form.quarter || null,
        brand: form.brand || null,
        line: form.line || null,
        model: form.model.trim() || null,
        dealer: form.dealer.trim() || null,
        tag: form.tag || null,
        impact: form.impact === '' ? null : Math.round(Number(form.impact)),
        body: form.body.trim().slice(0, 4000),
      });
      toast(form.visibility === 'client' ? 'Note saved; the client can see it' : 'Note saved for the Wheeler team');
      await reload();
      onClose();
    } catch (error) {
      setSaving(false);
      setStatus({ msg: `Couldn't save the note: ${error.message}`, err: true });
    }
  };

  return (
    <div className={cx('overlay')} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cx('sheet')} role="dialog" aria-modal="true" aria-label={label}>
        <div className={cx('cardhead')}>
          <div>
            <h3>{label}</h3>
            <p className={cx('sub')} style={{ margin: '2px 0 0' }}>
              {composeOnly
                ? 'Add context for a quarter, store, brand, model or dealer.'
                : `${list.length} note${list.length === 1 ? '' : 's'} across all quarters`}
            </p>
          </div>
          <button
            type="button"
            className={cx('btn', 'ghost')}
            onClick={onClose}
            ref={(el) => { if (!composeOnly) first.current = el; }}
          >
            Close
          </button>
        </div>
        {!composeOnly && (list.length
          ? <div className={cx('notes')}>{list.map((n) => <NoteCard key={n.id} n={n} />)}</div>
          : <p className={cx('empty')}>Nothing noted here yet.</p>)}
        {isWheeler && (
          <div className={cx('card')}>
            <h2 style={{ marginBottom: 10 }}>Add a note</h2>
            <datalist id="wpDealerList">{dealers.map((d) => <option key={d} value={d} />)}</datalist>
            <div className={cx('formgrid')}>
              <div className={cx('field')}>
                <label htmlFor="wpNoteLoc">Store</label>
                <select id="wpNoteLoc" value={form.location} onChange={set('location')}>
                  <option value="">All stores</option>
                  {locs.map((l) => <option key={l}>{l}</option>)}
                </select>
              </div>
              <div className={cx('field')}>
                <label htmlFor="wpNoteQ">Quarter</label>
                <select id="wpNoteQ" value={form.quarter} onChange={set('quarter')}>
                  <option value="">Any quarter</option>
                  {quarters.map((x) => <option key={x} value={x}>{periodLabel(x)}</option>)}
                </select>
              </div>
              <div className={cx('field')}>
                <label htmlFor="wpNoteBrand">Brand</label>
                <select id="wpNoteBrand" value={form.brand} onChange={set('brand')}>
                  <option value="">Any brand</option>
                  {brands.map((b) => <option key={b}>{b}</option>)}
                </select>
              </div>
              <div className={cx('field')}>
                <label htmlFor="wpNoteLine">Product line</label>
                <select id="wpNoteLine" value={form.line} onChange={set('line')}>
                  <option value="">Any line</option>
                  {lines.map((l) => <option key={l}>{l}</option>)}
                </select>
              </div>
              <div className={cx('field')}>
                <label htmlFor="wpNoteModel">Model (optional)</label>
                <input id="wpNoteModel" type="text" placeholder="e.g. Mule Pro-FXT" value={form.model} onChange={set('model')} />
              </div>
              <div className={cx('field')}>
                <label htmlFor="wpNoteDealer">Dealer or market (optional)</label>
                <input id="wpNoteDealer" type="text" list="wpDealerList" value={form.dealer} onChange={set('dealer')} />
              </div>
              <div className={cx('field')}>
                <label htmlFor="wpNoteTag">Reason</label>
                <select id="wpNoteTag" value={form.tag} onChange={set('tag')}>
                  <option value="">No tag</option>
                  {TAGS.map((t) => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div className={cx('field')}>
                <label htmlFor="wpNoteImpact">Est. units impact (optional)</label>
                <input id="wpNoteImpact" type="number" step={1} placeholder="e.g. 6" value={form.impact} onChange={set('impact')} />
              </div>
              <div className={cx('field', 'full')}>
                <label htmlFor="wpNoteVis">Who can see it</label>
                <select id="wpNoteVis" value={form.visibility} onChange={set('visibility')}>
                  <option value="internal">Wheeler only</option>
                  <option value="client">Client can see it too</option>
                </select>
              </div>
              <div className={cx('field', 'full')}>
                <label htmlFor="wpNoteText">Note</label>
                <textarea
                  id="wpNoteText"
                  ref={(el) => { if (composeOnly) first.current = el; }}
                  value={form.body}
                  onChange={set('body')}
                  placeholder="What happened and how it affected the numbers. e.g. Sales weren't lower on demand; we were out of Mule stock for 6 weeks, otherwise local sales would have been higher."
                />
              </div>
            </div>
            <div className={cx('actions')}>
              <button type="button" className={cx('btn', 'primary')} disabled={saving} onClick={save}>Save note</button>
              {status && <span className={cx('status', status.err && 'err')}>{status.msg}</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
