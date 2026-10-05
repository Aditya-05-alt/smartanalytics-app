/**
 * Lets the Overview VDP KPI + chart request run before heavy breakdown requests that hit the
 * same large table. Background fetches await `waitForPriorityRequests()`; it resolves when no
 * priority request is in flight, or after MAX_WAIT_MS so breakdowns are never starved.
 */

const MAX_WAIT_MS = 8000;

let pending = 0;
let waiters = [];

function flush() {
  const ready = waiters;
  waiters = [];
  ready.forEach((resolve) => resolve());
}

/** Marks a priority request as in flight. Returns `end()`; safe to call more than once. */
export function beginPriorityRequest() {
  pending += 1;
  let done = false;
  const timer = setTimeout(end, MAX_WAIT_MS);
  function end() {
    if (done) return;
    done = true;
    clearTimeout(timer);
    pending = Math.max(0, pending - 1);
    if (pending === 0) flush();
  }
  return end;
}

export async function waitForPriorityRequests() {
  if (typeof window === 'undefined') return;
  // Child effects run before the provider's effects in the same commit; yield one task so a
  // priority request started in that commit is registered before we decide to proceed.
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (pending === 0) return;
  await new Promise((resolve) => {
    waiters.push(resolve);
    setTimeout(resolve, MAX_WAIT_MS);
  });
}
