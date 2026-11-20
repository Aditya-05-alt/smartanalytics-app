'use client';
import { useState, useTransition } from 'react';
import { deleteCost } from './actions';

export default function DeleteButton({ slug, id, label }: { slug: string; id: string; label: string }) {
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState('');
  return (
    <>
      <button className="btn danger" type="button" disabled={pending} aria-label={`Delete ${label}`}
        style={confirm ? { background: 'var(--bad)', color: '#fff' } : undefined}
        onClick={() => {
          if (!confirm) { setConfirm(true); return; }
          start(async () => { const r = await deleteCost(slug, id); if (!r.ok) { setErr(r.message); setConfirm(false); } });
        }}>
        {confirm ? 'Confirm delete' : 'Delete'}
      </button>
      {err && <span className="note msg-err"> {err}</span>}
    </>
  );
}
