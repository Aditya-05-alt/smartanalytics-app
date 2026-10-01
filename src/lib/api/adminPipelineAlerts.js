export const PIPELINE_STEP_LABELS = {
  0: 'Setup',
  1: 'Step 1 · GA4 sync',
  2: 'Step 2 · Filtration',
  3: 'Step 3 · Final data',
};

export async function fetchPipelineAlerts() {
  const res = await fetch('/api/admin/pipeline-alerts', {
    credentials: 'same-origin',
    cache: 'no-store',
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'Failed to load pipeline alerts.');
  return json.snapshot;
}

export const PIPELINE_ALERTS_EVENT = 'pipeline-alerts:updated';
const PIPELINE_ALERTS_STORAGE_KEY = 'pipeline-alerts:updated-at';

/** Notifies the bell/alerts page in this tab (with the snapshot) and other tabs (via storage). */
export function broadcastPipelineAlerts(snapshot) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(PIPELINE_ALERTS_EVENT, { detail: snapshot }));
  try {
    window.localStorage.setItem(PIPELINE_ALERTS_STORAGE_KEY, String(Date.now()));
  } catch {
    /* storage unavailable */
  }
}

/** Calls `onRemoteUpdate` when another tab re-checked alerts. Returns an unsubscribe fn. */
export function subscribeRemotePipelineAlerts(onRemoteUpdate) {
  const onStorage = (e) => {
    if (e.key === PIPELINE_ALERTS_STORAGE_KEY) onRemoteUpdate();
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}

async function postPipelineAlerts(body, fallbackError) {
  const res = await fetch('/api/admin/pipeline-alerts', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || fallbackError);
  return json.snapshot;
}

export async function refreshPipelineAlerts({ from, to } = {}) {
  return postPipelineAlerts({ from, to }, 'Failed to re-check pipeline.');
}

/** Re-checks only these dealers and patches the latest snapshot; cleared alerts move to `resolved`. */
export async function recheckPipelineAlertDealers(dealerIds, { source = 'admin' } = {}) {
  return postPipelineAlerts({ dealerIds, source }, 'Failed to re-check dealer.');
}

/** One entry per dealer: worst severity first, then name. Pending items are kept but ranked last. */
export function groupAlertsByDealer(alerts = []) {
  const rank = { error: 0, warning: 1, pending: 2 };
  const byDealer = new Map();
  for (const a of alerts) {
    const key = String(a.dealerId ?? a.dealerName);
    if (!byDealer.has(key)) {
      byDealer.set(key, {
        dealerId: a.dealerId,
        dealerName: a.dealerName || 'Unnamed dealer',
        clientId: a.clientId,
        severity: a.severity,
        items: [],
      });
    }
    const group = byDealer.get(key);
    group.items.push(a);
    if (rank[a.severity] < rank[group.severity]) group.severity = a.severity;
  }
  return [...byDealer.values()].sort(
    (x, y) =>
      rank[x.severity] - rank[y.severity] || x.dealerName.localeCompare(y.dealerName)
  );
}

export function pipelineFixHref(alert) {
  const qs = new URLSearchParams();
  if (alert.dealerId != null) qs.set('dealer', String(alert.dealerId));
  if (alert.reportDate) {
    qs.set('from', alert.reportDate);
    qs.set('to', alert.reportDate);
  }
  return `/dashboard/admin/pipeline?${qs}`;
}
