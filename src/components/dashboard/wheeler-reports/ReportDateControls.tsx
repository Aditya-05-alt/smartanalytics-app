'use client';

import { useEffect, useState } from 'react';
import { useFreezeNav } from './FreezeContext';

type Range = { label: string; from: string; to: string };

type Props = {
  slug: string;
  from: string;
  to: string;
  months: Range[];
  quick: Range[];
};

export default function ReportDateControls({ slug, from, to, months, quick }: Props) {
  const { navigate } = useFreezeNav();
  // Optimistic selection so chips update on click, not after the 4s data wait.
  const [sel, setSel] = useState({ from, to });
  useEffect(() => {
    setSel({ from, to });
  }, [from, to]);

  const href = (f: string, t: string) =>
    `/dashboard/wheeler-reports/c/${slug}/report?from=${encodeURIComponent(f)}&to=${encodeURIComponent(t)}`;

  const go = (f: string, t: string) => {
    if (f === sel.from && t === sel.to) return;
    setSel({ from: f, to: t });
    navigate(href(f, t));
  };

  const monthActive = (x: Range) =>
    (sel.from === x.from && sel.to === x.to) ||
    (sel.from.slice(0, 7) === x.from.slice(0, 7) && sel.to.slice(0, 7) === x.from.slice(0, 7));

  return (
    <section className="controls" aria-label="Dates">
      <div className="chips" role="group" aria-label="Month">
        {months.map((x) => (
          <button
            key={x.from}
            type="button"
            className="chip"
            aria-current={monthActive(x) || undefined}
            onClick={() => go(x.from, x.to)}
          >
            {x.label}
          </button>
        ))}
      </div>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const f = String(fd.get('from') || '');
          const t = String(fd.get('to') || '');
          if (!f || !t) return;
          go(f, t);
        }}
      >
        <label className="field">
          <span>From</span>
          <input type="date" name="from" defaultValue={sel.from} key={`from-${sel.from}`} />
        </label>
        <label className="field">
          <span>To</span>
          <input type="date" name="to" defaultValue={sel.to} key={`to-${sel.to}`} />
        </label>
        <button className="btn ghost" type="submit">
          Show
        </button>
      </form>
      <div className="chips" role="group" aria-label="Quick ranges">
        {quick.map((x) => (
          <button
            key={x.label}
            type="button"
            className="chip"
            aria-pressed={x.from === sel.from && x.to === sel.to}
            onClick={() => go(x.from, x.to)}
          >
            {x.label}
          </button>
        ))}
      </div>
    </section>
  );
}
