/* Wheeler Pump In / Pump Out maths (ported from the wheeler-pump app's src/lib/calc.ts). */

/* ---------- formatting ---------- */
export const fmt = (n) => (n == null || Number.isNaN(n) ? '—' : Math.round(n).toLocaleString('en-US'));
export const pct = (n) => (n == null || !Number.isFinite(n) ? '—' : `${(n * 100).toFixed(0)}%`);
export const signed = (n) => (n > 0 ? '+' : '') + fmt(n);
export const slug = (s) => String(s).trim().replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';
export const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/* ---------- quarters ---------- */
export const qv = (q) => {
  const m = /^Q([1-4])\s+(\d{4})$/.exec(q || '');
  return m ? +m[2] * 4 + (+m[1] - 1) : null;
};
export const qname = (v) => `Q${(v % 4) + 1} ${Math.floor(v / 4)}`;
export const prevQ = (q) => (qv(q) == null ? null : qname(qv(q) - 1));
export const sortQ = (arr) =>
  [...new Set(arr)].filter((q) => qv(q) != null).sort((a, b) => qv(a) - qv(b));

/* ---------- months (rolling 12) ---------- */
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const mv = (e) => {
  const m = /^(\d{4})-(\d{2})$/.exec(e || '');
  return m ? +m[1] * 12 + (+m[2] - 1) : null;
};
export const mkey = (v) => `${Math.floor(v / 12)}-${String((v % 12) + 1).padStart(2, '0')}`;
export const endLabel = (e) => (mv(e) == null ? String(e) : `${MON[mv(e) % 12]} ${Math.floor(mv(e) / 12)}`);
export const endQ = (e) => {
  const v = mv(e);
  if (v == null || ((v % 12) + 1) % 3) return null;
  return `Q${((v % 12) + 1) / 3} ${Math.floor(v / 12)}`;
};
export const sortEnds = (a) => [...new Set(a)].filter((e) => mv(e) != null).sort((x, y) => mv(x) - mv(y));

/* ---------- periods: calendar quarters or rolling 12-month windows ---------- */
/** A rolling 12-month window as a period key, e.g. "R12 2026-09" (same form as the CSV template). */
export const r12Key = (end) => `R12 ${end}`;
const r12End = (p) => /^R12 (\d{4}-\d{2})$/.exec(p || '')?.[1] ?? null;
/** A calendar month as a period key, e.g. "M 2026-09". */
export const monthKey = (month) => `M ${month}`;
const monthOf = (p) => /^M (\d{4}-\d{2})$/.exec(p || '')?.[1] ?? null;
/** Display name for any period key: "Q3 2026", "12 mo to Sep 2026" or "Sep 2026". */
export const periodLabel = (p) => {
  if (r12End(p)) return `12 mo to ${endLabel(r12End(p))}`;
  if (monthOf(p)) return endLabel(monthOf(p));
  return String(p ?? '');
};
/** Months a period covers, as [first, last] month numbers (mv scale), for placing it on a date axis. */
export function periodSpan(p) {
  if (r12End(p)) return [mv(r12End(p)) - 11, mv(r12End(p))];
  if (monthOf(p)) return [mv(monthOf(p)), mv(monthOf(p))];
  if (qv(p) != null) {
    const first = Math.floor(qv(p) / 4) * 12 + (qv(p) % 4) * 3;
    return [first, first + 2];
  }
  return null;
}
/** Short month label for a month number on the date axis, e.g. "Sep 26". */
export const monthTick = (v) => `${MON[v % 12]} ${String(Math.floor(v / 12)).slice(2)}`;

/**
 * How the quarterly views step through time. Quarters compare with the previous quarter;
 * rolling windows compare with the window 12 months earlier (no overlapping months).
 */
export function periodModel(mode) {
  if (mode === 'm') {
    return {
      mode,
      pv: (p) => mv(monthOf(p)),
      prev: (p) => (monthOf(p) ? monthKey(mkey(mv(monthOf(p)) - 1)) : null),
      label: periodLabel,
      sort: (arr) => [...new Set(arr)].filter((p) => monthOf(p)).sort((a, b) => mv(monthOf(a)) - mv(monthOf(b))),
      unit: 'month',
      units: 'months',
    };
  }
  if (mode === 'r12') {
    return {
      mode,
      pv: (p) => mv(r12End(p)),
      prev: (p) => (r12End(p) ? r12Key(mkey(mv(r12End(p)) - 12)) : null),
      label: periodLabel,
      sort: (arr) => [...new Set(arr)].filter((p) => r12End(p)).sort((a, b) => mv(r12End(a)) - mv(r12End(b))),
      unit: 'window',
      units: 'rolling 12-month windows',
    };
  }
  return { mode: 'q', pv: qv, prev: prevQ, label: periodLabel, sort: sortQ, unit: 'quarter', units: 'quarters' };
}

/* ---------- totals ---------- */
export function totals(rows) {
  const t = { local: 0, pin: 0, pout: 0 };
  for (const r of rows) {
    t.local += r.local;
    t.pin += r.pin;
    t.pout += r.pout;
  }
  return { ...t, net: t.pout - t.pin, share: t.local + t.pin ? t.local / (t.local + t.pin) : null };
}

/** Compare a period with the previous one, like-for-like (only store+brand pairs present in both). */
export function compare(sum, q, keep, p = prevQ(q)) {
  const cur = sum.filter((r) => r.quarter === q && keep(r));
  const prv = sum.filter((r) => r.quarter === p && keep(r));
  const key = (r) => `${r.location}|${r.brand}`;
  const ck = new Set(cur.map(key));
  const pk = new Set(prv.map(key));
  const both = [...ck].filter((k) => pk.has(k));
  return {
    p,
    cur: totals(cur),
    curLfl: totals(cur.filter((r) => pk.has(key(r)))),
    prv: totals(prv.filter((r) => ck.has(key(r)))),
    hasPrev: both.length > 0,
    onlyCur: [...ck].filter((k) => !pk.has(k)),
    onlyPrev: [...pk].filter((k) => !ck.has(k)),
  };
}

/* ---------- rolling 12 maths ---------- */
/** R12(E) − R12(E − 3 months) = the 3 months ending E minus the same 3 months a year earlier. */
export function yoyChanges(rows) {
  const idx = new Map(rows.map((r) => [`${r.location}|${r.brand}|${r.line}|${r.end}`, r]));
  const out = [];
  for (const r of rows) {
    const pe = mkey(mv(r.end) - 3);
    const p = idx.get(`${r.location}|${r.brand}|${r.line}|${pe}`);
    if (p) {
      out.push({
        location: r.location, brand: r.brand, line: r.line, end: r.end, prevEnd: pe, quarter: endQ(r.end),
        dLocal: r.local - p.local, dPin: r.pin - p.pin, dPout: r.pout - p.pout,
      });
    }
  }
  return out;
}

/** Exact quarters from rolling reports, anchored on the same quarter a year earlier (or later). */
export function calcQuarters(realSum, r12) {
  const ch = yoyChanges(r12).filter((c) => c.quarter);
  if (!ch.length) return [];
  const have = new Map();
  for (const r of realSum) {
    const k = `${r.location}|${r.brand}|${r.line}|${r.quarter}`;
    const x = have.get(k) || { local: 0, pin: 0, pout: 0 };
    x.local += r.local;
    x.pin += r.pin;
    x.pout += r.pout;
    have.set(k, x);
  }
  const calc = [];
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 12) {
    changed = false;
    for (const c of ch) {
      const base = `${c.location}|${c.brand}|${c.line}|`;
      const q = c.quarter;
      const q0 = qname(qv(q) - 4);
      const A = have.get(base + q0);
      const B = have.get(base + q);
      const span = `rolling 12 to ${endLabel(c.end)} − rolling 12 to ${endLabel(c.prevEnd)}`;
      let v = null;
      let qq = '';
      let src = '';
      if (A && !B) {
        v = { local: A.local + c.dLocal, pin: A.pin + c.dPin, pout: A.pout + c.dPout };
        qq = q;
        src = `Calculated: ${q0} + (${span})`;
      } else if (B && !A) {
        v = { local: B.local - c.dLocal, pin: B.pin - c.dPin, pout: B.pout - c.dPout };
        qq = q0;
        src = `Calculated: ${q} − (${span})`;
      }
      if (v) {
        have.set(base + qq, v);
        calc.push({ quarter: qq, location: c.location, brand: c.brand, line: c.line, ...v, source: src, calc: true });
        changed = true;
      }
    }
  }
  return calc;
}

/* ---------- notes ---------- */
export const TAGS = [
  'Inventory / stock', 'OEM allocation', 'Pricing / promo', 'Marketing', 'Staffing',
  'Weather / season', 'Competitor', 'Data / report issue', 'Other',
];

export function notesFor(notes, ctx) {
  return notes
    .filter((n) => {
      if (ctx.location && n.location && n.location !== ctx.location) return false;
      if ('brand' in ctx && (n.brand || null) !== (ctx.brand || null)) return false;
      if ('line' in ctx && (n.line || null) !== (ctx.line || null)) return false;
      if ('dealer' in ctx && (n.dealer || null) !== (ctx.dealer || null)) return false;
      if (ctx.quarter && n.quarter && n.quarter !== ctx.quarter) return false;
      if (ctx.quarterStrict && n.quarter !== ctx.quarterStrict) return false;
      return true;
    })
    .sort((a, b) => (qv(b.quarter) ?? 0) - (qv(a.quarter) ?? 0)
      || String(b.created_at).localeCompare(String(a.created_at)));
}

/* ---------- review helpers ---------- */
const OTHER_NAME = /^other (dealers|markets)$/i;

/**
 * One product line can come back under different names from different report types
 * (Polaris "XVR" / "XVR (Crossover)" / "Xpedition" from an XVR report, "SNO" / "Snowmobile",
 * "RGR" / "Ranger"). Lines are named one way so overlapping reports merge instead of stacking.
 * "Xpedition" alone stays as is: Dealership & Market Performance reports list it separately.
 */
export function canonLine(line, report = '') {
  const l = String(line || 'All').trim();
  if (/\bxvr\b|crossover/i.test(l) || (/^xpedition$/i.test(l) && /\bxvr\b|crossover/i.test(report))) return 'XVR';
  if (/^(sno|snow|snowmobiles?)$/i.test(l)) return 'Snowmobile';
  if (/^(rgr|ranger)$/i.test(l)) return 'Ranger';
  if (/^(rzr)$/i.test(l)) return 'RZR';
  if (/^(atv|atvs)$/i.test(l)) return 'ATV';
  return l;
}

/**
 * Several reports can describe the same store, brand, line and period (Polaris sends a Scorecard,
 * a Sell-In and a Sell-Out report for one window). Each leaves the figures it doesn't carry at 0,
 * so a line is merged by taking the largest value of each figure, never by adding the reports up.
 * Dealer rows carry `file` and `lines` (the product lines of the report they came from); per
 * period, store, brand, direction and lines, only the report naming the most dealers is kept.
 */
export function combineReports(sum, dl, pk) {
  const lines = new Map();
  for (const r of sum) {
    const k = [r[pk], r.location, r.brand, r.line].join('|');
    const m = lines.get(k);
    if (!m) {
      lines.set(k, { ...r, sources: [r.source] });
      continue;
    }
    m.local = Math.max(m.local, r.local);
    m.pin = Math.max(m.pin, r.pin);
    m.pout = Math.max(m.pout, r.pout);
    if (!m.sources.includes(r.source)) m.sources.push(r.source);
  }

  const groups = new Map();
  for (const d of dl) {
    const k = [d[pk], d.location, d.brand, d.dir, d.lines ?? ''].join('|');
    if (!groups.has(k)) groups.set(k, new Map());
    const byFile = groups.get(k);
    if (!byFile.has(d.file)) byFile.set(d.file, []);
    byFile.get(d.file).push(d);
  }
  const named = (rows) => rows.filter((d) => !OTHER_NAME.test(d.name)).length;
  const units = (rows) => rows.reduce((a, d) => a + d.units, 0);
  const dealers = [];
  for (const byFile of groups.values()) {
    const [best] = [...byFile.values()].sort((a, b) => named(b) - named(a) || units(b) - units(a));
    dealers.push(...best.map(({ file, lines: _lines, ...d }) => ({ ...d })));
  }

  return {
    sum: [...lines.values()].map(({ sources, ...r }) => ({ ...r, source: sources.join('; ') })),
    dl: dealers,
  };
}

/** Make named dealers/markets add up to the totals, filling the rest as "Other dealers" / "Other markets". */
export function balance(sum, dl, warn, pk) {
  const keys = new Set(sum.map((r) => `${r[pk]}|${r.location}|${r.brand}`));
  for (const k of keys) {
    const [per, location, brand] = k.split('|');
    const s = sum.filter((r) => r[pk] === per && r.location === location && r.brand === brand);
    for (const [dir, field, other] of [['In', 'pin', 'Other dealers'], ['Out', 'pout', 'Other markets']]) {
      const tot = s.reduce((a, r) => a + r[field], 0);
      const ds = dl.filter((d) => d[pk] === per && d.location === location && d.brand === brand && d.dir === dir);
      const got = ds.reduce((a, d) => a + d.units, 0);
      if (got < tot) {
        const o = ds.find((d) => d.name === other);
        if (o) o.units += tot - got;
        else dl.push({ [pk]: per, location, brand, dir, name: other, units: tot - got });
      } else if (got > tot) {
        warn.push(`${brand} ${pk === 'end' ? `rolling 12 to ${endLabel(per)}` : pk === 'month' ? endLabel(per) : per} ${location}: named ${dir === 'In' ? 'dealers' : 'markets'} add to ${got}, more than the ${tot} total. Check before saving.`);
      }
    }
  }
}
