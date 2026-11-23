'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import CalendarRangePicker, {
  rangePickerValueFromISO,
  resolveRangePickerValue,
} from '@/components/dashboard/CalendarRangePicker';
import { useFreezeNav } from './FreezeContext';
import LocationMultiSelect from './LocationMultiSelect';
import { serializeLocations } from '@/lib/wheelerReports/filterByLocation';

type Range = { label: string; from: string; to: string };
type Location = { id: string; name: string };

type Props = {
  slug: string;
  from: string;
  to: string;
  /** Selected store names; empty = all locations. */
  locationsSelected: string[];
  locations: Location[];
  months: Range[];
  quick: Range[];
  /** Latest selectable day (client timezone today). */
  maxDate?: string;
};

export default function ReportDateControls({
  slug, from, to, locationsSelected, locations, months, quick, maxDate,
}: Props) {
  const router = useRouter();
  const { navigate } = useFreezeNav();
  const [pending, startTransition] = useTransition();
  const [sel, setSel] = useState({ from, to, locations: locationsSelected });
  useEffect(() => {
    setSel({ from, to, locations: locationsSelected });
  }, [from, to, locationsSelected]);

  const pickerValue = useMemo(
    () => rangePickerValueFromISO(sel.from, sel.to) || { start: sel.from, end: sel.to, preset: 'custom' },
    [sel.from, sel.to],
  );

  const reportHref = (f: string, t: string, locs: string[]) => {
    const q = new URLSearchParams({ from: f, to: t });
    const loc = serializeLocations(locs);
    if (loc) q.set('location', loc);
    return `/dashboard/wheeler-reports/c/${slug}/report?${q}`;
  };

  useEffect(() => {
    const focus = [
      ...months.map((x) => reportHref(x.from, x.to, sel.locations)),
      ...quick.map((x) => reportHref(x.from, x.to, sel.locations)),
      reportHref(sel.from, sel.to, []),
    ];
    for (const h of focus) router.prefetch(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, sel.from, sel.to, sel.locations, months, quick, router]);

  const sameLocs = (a: string[], b: string[]) => {
    if (a.length !== b.length) return false;
    const sb = new Set(b);
    return a.every((x) => sb.has(x));
  };

  const go = (f: string, t: string, locs = sel.locations) => {
    if (f === sel.from && t === sel.to && sameLocs(locs, sel.locations)) return;
    setSel({ from: f, to: t, locations: locs });
    startTransition(() => {
      navigate(reportHref(f, t, locs));
    });
  };

  const onRangeChange = (next: string | { start: string; end: string; preset?: string }) => {
    const resolved = resolveRangePickerValue(next);
    if (!resolved?.start || !resolved?.end) return;
    let f = resolved.start;
    let t = resolved.end;
    if (f > t) [f, t] = [t, f];
    go(f, t, sel.locations);
  };

  const monthActive = (x: Range) =>
    (sel.from === x.from && sel.to === x.to) ||
    (sel.from.slice(0, 7) === x.from.slice(0, 7) && sel.to.slice(0, 7) === x.from.slice(0, 7));

  return (
    <section className={'controls' + (pending ? ' is-pending' : '')} aria-label="Report filters" aria-busy={pending || undefined}>
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
      <div className="row wr-filter-row">
        <div className="field wr-date-field">
          <span>Date range</span>
          <CalendarRangePicker
            value={pickerValue}
            onChange={onRangeChange}
            maxDate={maxDate || undefined}
          />
        </div>
        <div className="field wr-location-field">
          <span>Location</span>
          <LocationMultiSelect
            locations={locations}
            value={Array.isArray(sel.locations) ? sel.locations : []}
            onChange={(next) => go(sel.from, sel.to, next)}
          />
        </div>
      </div>
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
