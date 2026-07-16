async function parseJson(res) {
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'Request failed.');
  return json;
}

export async function fetchAdminDealers({ activeOnly = false, search = '' } = {}) {
  const qs = new URLSearchParams();
  if (activeOnly) qs.set('activeOnly', 'true');
  if (search) qs.set('search', search);

  const suffix = qs.toString() ? `?${qs}` : '';
  const res = await fetch(`/api/admin/dealers${suffix}`, {
    credentials: 'same-origin',
  });
  return parseJson(res);
}

export async function createAdminDealer(payload) {
  const res = await fetch('/api/admin/dealers', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJson(res);
}

export async function updateAdminDealer(id, payload) {
  const res = await fetch(`/api/admin/dealers/${id}`, {
    method: 'PATCH',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJson(res);
}

/** Switch a dealer on/off — off hides it from dashboard dropdowns (VDP overview). */
export async function setAdminDealerActive(id, active) {
  const res = await fetch(`/api/admin/dealers/${id}/active`, {
    method: 'PATCH',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ active: active === true }),
  });
  return parseJson(res);
}

export async function deleteAdminDealer(id, { hard = false } = {}) {
  const qs = hard ? '?hard=true' : '';
  const res = await fetch(`/api/admin/dealers/${id}${qs}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  });
  return parseJson(res);
}
