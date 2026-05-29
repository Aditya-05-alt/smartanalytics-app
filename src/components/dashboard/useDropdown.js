'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

/**
 * Tiny self-contained dropdown helper.
 *  - Returns ref to attach to the wrapper.
 *  - Auto-closes on outside click + Escape.
 *  - Single shared listener via the wrapper ref → cheap.
 */
export function useDropdown(initial = false) {
  const [open, setOpen] = useState(initial);
  const ref = useRef(null);

  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((o) => !o), []);

  useEffect(() => {
    if (!open) return undefined;

    function onPointer(e) {
      if (ref.current && !ref.current.contains(e.target)) close();
    }
    function onKey(e) {
      if (e.key === 'Escape') close();
    }

    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  return { open, setOpen, toggle, close, ref };
}
