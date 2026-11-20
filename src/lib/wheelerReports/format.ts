const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

type N = number | null | undefined;
const dash = '–';
export const USD = (v: N) => (v == null || !Number.isFinite(v) ? dash : usd0.format(v));
export const USD2 = (v: N) => (v == null || !Number.isFinite(v) ? dash : usd2.format(v));
export const NUM = (v: N) => (v == null || !Number.isFinite(v) ? dash : int.format(v));
export const PCT = (v: N, digits = 0) => (v == null || !Number.isFinite(v) ? dash : `${(v * 100).toFixed(digits)}%`);
