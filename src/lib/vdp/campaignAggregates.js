export function fmt(n) {
  return Math.round(n).toLocaleString('en-US');
}

export function pct(n) {
  return (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
}

export function momClass(n) {
  return n > 0.05 ? 'up' : n < -0.05 ? 'down' : 'flat';
}

export function safeDiv(a, b) {
  return b === 0 ? 0 : a / b;
}
