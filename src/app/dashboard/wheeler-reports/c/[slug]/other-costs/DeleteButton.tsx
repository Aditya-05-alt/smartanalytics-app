'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useFreezeNav } from '@/components/dashboard/wheeler-reports/FreezeContext';
import { deleteCost } from './actions';

export default function DeleteButton({ slug, id, label }: { slug: string; id: string; label: string }) {
  const router = useRouter();
  const { invalidate } = useFreezeNav();
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState('');
  return (
    <>
      <button className="btn danger" type="button" disabled={pending} aria-label={`Delete ${label}`}
        style={confirm ? { background: 'var(--bad)', color: '#fff' } : undefined}
        onClick={() => {
          if (!confirm) { setConfirm(true); return; }
          start(async () => {
            const r = await deleteCost(slug, id);
            if (!r.ok) {
              setErr(r.message);
              setConfirm(false);
              return;
            }
            invalidate(['other-costs', 'report']);
            router.refresh();
          });
        }}>
        {confirm ? 'Confirm delete' : 'Delete'}
      </button>
      {err && <span className="note msg-err"> {err}</span>}
    </>
  );
}
