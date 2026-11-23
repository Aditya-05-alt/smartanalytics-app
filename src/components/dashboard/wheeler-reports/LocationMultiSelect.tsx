'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type Location = { id: string; name: string };

type Props = {
  locations: Location[];
  value?: string[];
  onChange: (next: string[]) => void;
};

function same(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  const s = new Set(b);
  return a.every((x) => s.has(x));
}

/** Multi-select location picker — menu portals above overflow so it stays clickable. */
export default function LocationMultiSelect({ locations, value, onChange }: Props) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(() => value ?? []);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const selected = value ?? [];

  useEffect(() => {
    if (!open) setDraft(selected);
  }, [selected, open]);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const place = () => {
      const r = btnRef.current!.getBoundingClientRect();
      setMenuPos({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 180) });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
      if (!same(draft, selected)) onChange(draft);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      setDraft(selected);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, draft, selected, onChange]);

  const allSelected = draft.length === 0;
  const label = allSelected
    ? 'All locations'
    : draft.length === 1
      ? draft[0]
      : `${draft.length} locations`;

  const toggle = (name: string) => {
    const next = new Set(allSelected ? [] : draft);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    if (next.size === locations.length) setDraft([]);
    else setDraft([...next]);
  };

  const closeAndApply = () => {
    setOpen(false);
    if (!same(draft, selected)) onChange(draft);
  };

  const menu = open && menuPos && typeof document !== 'undefined'
    ? createPortal(
      <div
        ref={menuRef}
        className="wr-loc-multi-menu"
        id={id}
        role="listbox"
        aria-multiselectable="true"
        aria-label="Location"
        style={{
          position: 'fixed',
          top: menuPos.top,
          left: menuPos.left,
          width: menuPos.width,
          zIndex: 10050,
        }}
      >
        <label className="wr-loc-multi-opt">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={() => setDraft([])}
          />
          <span>All locations</span>
        </label>
        <div className="wr-loc-multi-sep" />
        {locations.map((l) => (
          <label key={l.id} className="wr-loc-multi-opt">
            <input
              type="checkbox"
              checked={draft.includes(l.name)}
              onChange={() => toggle(l.name)}
            />
            <span>{l.name}</span>
          </label>
        ))}
        <button type="button" className="wr-loc-multi-apply" onClick={closeAndApply}>
          Apply
        </button>
      </div>,
      document.body,
    )
    : null;

  return (
    <div className="wr-loc-multi" ref={rootRef}>
      <button
        ref={btnRef}
        type="button"
        className="wr-loc-multi-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (open) closeAndApply();
          else {
            setDraft(selected);
            setOpen(true);
          }
        }}
      >
        <span className="wr-loc-multi-label">{label}</span>
        <span className="wr-loc-multi-caret" aria-hidden>▾</span>
      </button>
      {menu}
    </div>
  );
}
