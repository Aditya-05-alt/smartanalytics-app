// Date helpers. All dates are plain 'YYYY-MM-DD' strings handled in UTC so a
// reader's own time zone never shifts a day.

const DAY = 86_400_000;

export const toUTC = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
export const fromUTC = (t: number) => new Date(t).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => fromUTC(toUTC(d) + n * DAY);

/** Days from a to b, both included. */
export const daysIncl = (a: string, b: string) => Math.round((toUTC(b) - toUTC(a)) / DAY) + 1;

/** Days shared by [a1, a2] and [b1, b2], both included; 0 if they don't meet. */
export const overlapDays = (a1: string, a2: string, b1: string, b2: string) => {
  const s = a1 > b1 ? a1 : b1;
  const e = a2 < b2 ? a2 : b2;
  return s > e ? 0 : daysIncl(s, e);
};

/** Share of a row's period [from, to] that falls in the selected dates. */
export const prorate = (rowFrom: string, rowTo: string, selFrom: string, selTo: string) =>
  overlapDays(rowFrom, rowTo, selFrom, selTo) / daysIncl(rowFrom, rowTo);

export const monthStart = (d: string) => d.slice(0, 7) + '-01';
export const monthEnd = (d: string) => {
  const y = +d.slice(0, 4), m = +d.slice(5, 7);
  return fromUTC(Date.UTC(y, m, 0));
};

/** Every month (as YYYY-MM-01) touched by [from, to]. */
export const monthsIn = (from: string, to: string) => {
  const out: string[] = [];
  let m = monthStart(from);
  while (m <= to) {
    out.push(m);
    m = addDays(monthEnd(m), 1);
  }
  return out;
};

export const isISODate = (s: unknown): s is string =>
  typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(toUTC(s)) && fromUTC(toUTC(s)) === s;

/** Calendar date of an instant in a time zone, as YYYY-MM-DD. */
export const dateInZone = (instant: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);

export const todayInZone = (timeZone: string) => dateInZone(new Date(), timeZone);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthName = (d: string) => `${MONTHS[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}`;
export const shortDate = (d: string) => `${MONTHS[+d.slice(5, 7) - 1].slice(0, 3)} ${+d.slice(8, 10)}`;
export const rangeLabel = (from: string, to: string) =>
  from === to ? `${shortDate(from)}, ${from.slice(0, 4)}`
    : from.slice(0, 4) === to.slice(0, 4) ? `${shortDate(from)} – ${shortDate(to)}, ${to.slice(0, 4)}`
    : `${shortDate(from)}, ${from.slice(0, 4)} – ${shortDate(to)}, ${to.slice(0, 4)}`;

/** Parse "November 1, 2026 - November 15, 2026" (Google Ads report header). */
export const parseLongRange = (s: string): { from: string; to: string } | null => {
  const m = s.match(/([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s*[-–]\s*([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/);
  if (!m) return null;
  const mi = (name: string) => MONTHS.findIndex((x) => x.toLowerCase().startsWith(name.toLowerCase().slice(0, 3)));
  const a = mi(m[1]), b = mi(m[4]);
  if (a < 0 || b < 0) return null;
  const f = (y: string, mo: number, d: string) => `${y}-${String(mo + 1).padStart(2, '0')}-${d.padStart(2, '0')}`;
  return { from: f(m[3], a, m[2]), to: f(m[6], b, m[5]) };
};
