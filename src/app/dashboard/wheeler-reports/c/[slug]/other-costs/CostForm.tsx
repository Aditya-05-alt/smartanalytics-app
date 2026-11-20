'use client';
import { useState, useTransition } from 'react';
import { addCosts, addHead } from './actions';

const usd = (v: number) => v.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

export default function CostForm({ slug, month, stores, heads }: { slug: string; month: string; stores: { id: string; name: string }[]; heads: string[] }) {
  const [store, setStore] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [extra, setExtra] = useState<string[]>([]);
  const [newHead, setNewHead] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const all = [...heads, ...extra.filter((h) => !heads.some((x) => x.toLowerCase() === h.toLowerCase()))];
  const toggle = (h: string) => setPicked((p) => (p.includes(h) ? p.filter((x) => x !== h) : [...p, h]));
  const total = picked.reduce((a, h) => a + (parseFloat(amounts[h]) || 0), 0);

  const submit = () => {
    if (!store) return setMsg({ ok: false, text: 'Choose a store location.' });
    if (!picked.length) return setMsg({ ok: false, text: 'Pick at least one cost head.' });
    const items = picked.map((h) => ({ head: h, amount: Math.round(parseFloat(amounts[h]) * 100) / 100 }));
    const bad = items.find((i) => !(i.amount > 0));
    if (bad) return setMsg({ ok: false, text: `Enter an amount greater than zero for ${bad.head}.` });
    start(async () => {
      const r = await addCosts(slug, { month, storeId: store, items });
      setMsg({ ok: r.ok, text: r.ok ? `${r.message} ${items.map((i) => `${i.head} ${usd(i.amount)}`).join(', ')}.` : r.message });
      if (r.ok) { setPicked([]); setAmounts({}); setStore(''); }
    });
  };
  const addNew = () => {
    const h = newHead.trim().replace(/\s+/g, ' ');
    if (!h) return;
    const existing = all.find((x) => x.toLowerCase() === h.toLowerCase());
    const name = existing ?? h;
    if (!existing) setExtra((e) => [...e, name]);
    setPicked((p) => (p.includes(name) ? p : [...p, name]));
    setNewHead('');
    if (!existing) start(async () => { const r = await addHead(slug, name); setMsg({ ok: r.ok, text: r.message }); });
  };

  return (
    <div className="body">
      <label className="field" style={{ maxWidth: '22rem' }}><span>Store location</span>
        <select value={store} onChange={(e) => setStore(e.target.value)}>
          <option value="">Choose a store</option>
          {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          <option value="all">All stores</option>
        </select>
      </label>
      <div className="field"><span className="lbl" id="heads-lbl">Cost head — pick one or more</span>
        <div className="chips" role="group" aria-labelledby="heads-lbl">
          {all.map((h) => <button key={h} type="button" className="chip" aria-pressed={picked.includes(h)} onClick={() => toggle(h)}>{h}</button>)}
        </div>
        <div className="row" style={{ maxWidth: '30rem' }}>
          <input value={newHead} onChange={(e) => setNewHead(e.target.value)} maxLength={60} placeholder="Add a new cost head, e.g. Podcast" aria-label="New cost head"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addNew(); } }} style={{ flex: '1 1 12rem' }} />
          <button className="btn ghost" type="button" onClick={addNew}>Add to list</button>
        </div>
      </div>
      <div className="field"><span className="lbl">Amount for each cost head (USD)</span>
        {picked.length === 0 && <p className="note">Pick at least one cost head above.</p>}
        {picked.map((h) => (
          <div key={h} className="row" style={{ maxWidth: '30rem' }}>
            <span style={{ flex: 1, fontWeight: 600 }}>{h}</span>
            <input type="number" min="0.01" step="0.01" inputMode="decimal" placeholder="0.00" aria-label={`Amount for ${h}`} style={{ width: '9rem' }}
              value={amounts[h] ?? ''} onChange={(e) => setAmounts((a) => ({ ...a, [h]: e.target.value }))} />
            <button type="button" className="btn ghost" aria-label={`Remove ${h}`} onClick={() => toggle(h)}>×</button>
          </div>
        ))}
        {picked.length > 1 && <p className="note"><b>Total {usd(total)}</b></p>}
      </div>
      <div className="row"><button className="btn" type="button" onClick={submit} disabled={pending}>{pending ? 'Saving…' : 'Submit'}</button></div>
      {msg && <p className={'note ' + (msg.ok ? 'msg-ok' : 'msg-err')} role="status">{msg.text}</p>}
    </div>
  );
}
