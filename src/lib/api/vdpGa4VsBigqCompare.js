/**
 * VDP Lab — all-dealer VDP views compare
 * (smart_ga4_page_data vdp_conditions vs full smart_ga4_bigq_daily_raw_data).
 */
export async function fetchVdpGa4VsBigqCompare({ from, to, status } = {}) {
  const params = new URLSearchParams();
  if (from) params.set('from', String(from).slice(0, 10));
  if (to) params.set('to', String(to).slice(0, 10));
  if (status && status !== 'all') params.set('status', status);

  const qs = params.toString();
  const res = await fetch(
    `/api/dashboard/vdp-ga4-vs-bigq${qs ? `?${qs}` : ''}`,
    {
      method: 'GET',
      cache: 'no-store',
    }
  );

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.error || `VDP compare failed (${res.status})`);
  }

  return {
    rows: Array.isArray(body.rows) ? body.rows : [],
    meta: body.meta || {},
  };
}
