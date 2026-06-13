export async function fetchPipelineDealers() {
  const res = await fetch('/api/admin/pipeline/dealers', { credentials: 'same-origin' });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'Failed to load dealers.');
  return json.dealers || [];
}

export async function fetchPipelineStats({ clientId, from, to }) {
  const qs = new URLSearchParams({ clientId, from, to });
  const res = await fetch(`/api/admin/pipeline/stats?${qs}`, {
    credentials: 'same-origin',
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'Failed to load pipeline stats.');
  return json;
}

/** Step 1 — Node GA4 page sync → smart_ga4_page_data */
export async function runPipelinePageSync({ clientId, from, to }) {
  const res = await fetch('/api/admin/pipeline/sync-page', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, from, to }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'Page sync failed.');
  return json;
}

/** Step 2 — apply_vdp_filtration_range RPC */
export async function runPipelineFiltration({ clientId, from, to }) {
  const res = await fetch('/api/admin/pipeline/filtration', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, from, to }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'Filtration failed.');
  return json;
}

/** Step 3 — final VDP sync RPC */
export async function runPipelineFinalSync({ clientId, from, to }) {
  const res = await fetch('/api/admin/pipeline/final-sync', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, from, to }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'Final sync failed.');
  return json;
}
