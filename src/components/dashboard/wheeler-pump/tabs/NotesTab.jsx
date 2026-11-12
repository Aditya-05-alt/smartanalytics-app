'use client';

import { qv, TAGS } from '@/lib/wheelerPump/calc';
import { NoteCard } from '../NotesSheet';
import { Card, cx, useDash } from '../ui';

export default function NotesTab() {
  const { data, loc, brand, q, isWheeler, openNotes } = useDash();
  const list = data.notes
    .filter((n) => (loc === 'All' || !n.location || n.location === loc) && (brand === 'All' || !n.brand || n.brand === brand))
    .sort((a, b) => (qv(b.quarter) ?? 0) - (qv(a.quarter) ?? 0) || String(b.created_at).localeCompare(String(a.created_at)));
  const byTag = TAGS.map((t) => [t, list.filter((n) => n.tag === t).length]).filter((x) => x[1]);
  return (
    <Card
      title="Notes log"
      sub={`${list.length} notes${byTag.length ? ` · ${byTag.map(([t, c]) => `${t} ${c}`).join(' · ')}` : ''}`}
      action={isWheeler ? (
        <button
          className={cx('btn', 'primary')}
          type="button"
          onClick={() => openNotes({ location: loc === 'All' ? null : loc, quarter: q, brand: brand === 'All' ? null : brand }, 'New note', true)}
        >
          + Add note
        </button>
      ) : undefined}
    >
      {list.length
        ? <div className={cx('notes')}>{list.map((n) => <NoteCard key={n.id} n={n} />)}</div>
        : (
          <p className={cx('empty')}>
            No notes yet.{isWheeler ? ' Use the note pills on any store, brand, model, dealer or quarter to record what was going on.' : ''}
          </p>
        )}
    </Card>
  );
}
