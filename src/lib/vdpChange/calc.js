/*
 * VDP Change maths. For each channel: VDP rebuilt from traffic is
 *   Users × Sessions per user × Pages per session × the channel's standard VDP rate,
 * for both periods. Its % change, applied to last period's actual VDP, is the part traffic explains;
 * whatever is left of the actual change is the real change. The standard rate is the same in both
 * periods, so it cancels out of a channel's % change; it only weights channels in the dealer total.
 */

export const CHANNELS = [
  { key: 'Paid Search', paid: 'Google Ads' },
  { key: 'PMax', paid: 'Google Ads' },
  { key: 'Paid Social', paid: 'Meta' },
  { key: 'Organic Search' },
  { key: 'Direct' },
  { key: 'Organic Social' },
  { key: 'Other' },
];
/** Channels under this many VDP views last period are too small to read. */
export const MIN_CHANNEL_VDP = 100;

const EMPTY = { users: 0, sessions: 0, pageViews: 0, vdp: 0 };
const round2 = (n) => Math.round(n * 100) / 100;
const ratio = (a, b) => (b > 0 ? a / b : 0);

/**
 * Worksheet for one channel (rate given) or the whole dealer (estimates given as [e0, e1]).
 * Ratios are rounded to 2 decimals and counts rebuilt from them, so every product shown checks out.
 */
export function worksheet(a, b, rate, estimates) {
  const x = { u0: Math.round(a.users), u1: Math.round(b.users), v0: Math.round(a.vdp), v1: Math.round(b.vdp) };
  x.spu0 = round2(ratio(a.sessions, a.users));
  x.spu1 = round2(ratio(b.sessions, b.users));
  x.s0 = Math.round(x.u0 * x.spu0);
  x.s1 = Math.round(x.u1 * x.spu1);
  x.pps0 = round2(ratio(a.pageViews, a.sessions));
  x.pps1 = round2(ratio(b.pageViews, b.sessions));
  x.pv0 = Math.round(x.s0 * x.pps0);
  x.pv1 = Math.round(x.s1 * x.pps1);
  if (estimates) {
    [x.e0, x.e1] = estimates;
    x.rate = null;
    x.r0 = ratio(x.e0, x.pv0);
    x.r1 = ratio(x.e1, x.pv1);
  } else {
    x.rate = rate;
    x.e0 = Math.round(x.pv0 * rate);
    x.e1 = Math.round(x.pv1 * rate);
  }
  x.diff = x.v1 - x.v0;
  // No traffic last period: the new traffic explains the whole change.
  x.ePct = x.e0 > 0 ? (x.e1 / x.e0 - 1) * 100 : null;
  x.traffic = x.e0 > 0 ? Math.round(x.v0 * (x.e1 / x.e0 - 1)) : x.diff;
  x.real = x.diff - x.traffic;
  x.diffPct = x.v0 > 0 ? (x.diff / x.v0) * 100 : null;
  x.trafficPct = x.v0 > 0 ? (x.traffic / x.v0) * 100 : null;
  x.realPct = x.v0 > 0 ? (x.real / x.v0) * 100 : null;
  return x;
}

/** One dealer's worksheets: per channel (CW) and all channels (W). Null when GA4 traffic is missing. */
export function dealerChange(dealer, rates) {
  const prevAll = dealer.prev['(all)'];
  const curAll = dealer.cur['(all)'];
  if (!prevAll || !curAll) return null;
  const CW = {};
  let e0 = 0;
  let e1 = 0;
  let v0 = 0;
  let v1 = 0;
  for (const { key } of CHANNELS) {
    const a = dealer.prev[key] || EMPTY;
    const b = dealer.cur[key] || EMPTY;
    const w = worksheet(a, b, rates[key] ?? 0);
    CW[key] = w;
    e0 += w.e0;
    e1 += w.e1;
    v0 += a.vdp;
    v1 += b.vdp;
  }
  const W = worksheet({ ...prevAll, vdp: v0 }, { ...curAll, vdp: v1 }, null, [e0, e1]);
  return { ...dealer, W, CW, V0: v0, V1: v1, inv0: dealer.stock.prev, inv1: dealer.stock.cur };
}

export const pctChange = (a, b) => (a > 0 ? (b / a - 1) * 100 : null);
