/**
 * Overview bundle for All tab KPI + chart.
 * Uses server API (service role) — required after RLS on smart_ga4_page_data.
 */

import { appendAnalyticsScope } from '@/lib/analytics/analyticsScope';

async function fetchOverviewViaApi({ clientId, from, to, ga4PropertyId, onCancelCheck }) {
  if (typeof window === 'undefined') return null;
  if (onCancelCheck?.()) return null;

  const qs = appendAnalyticsScope(
    new URLSearchParams({ clientId, from, to }),
    { ga4PropertyId }
  );
  const res = await fetch(`/api/dashboard/overview?${qs}`, { credentials: 'same-origin' });
  const json = await res.json().catch(() => ({}));

  if (onCancelCheck?.()) return null;
  if (!res.ok) {
    if (res.status === 503) {
      throw new Error(
        json.error ||
          'SUPABASE_SERVICE_ROLE_KEY is not configured on the server. Add it to .env.local and restart npm run dev.'
      );
    }
    throw new Error(json.error || `Overview request failed (${res.status})`);
  }

  return {
    rows: json.rows || [],
    userTotalsRows: json.userTotalsRows || [],
  };
}

/** Overview bundle — chunked 5-day RPC windows via service-role API. */
export async function fetchOverviewBundle({
  clientId,
  from,
  to,
  ga4PropertyId,
  onCancelCheck,
}) {
  if (!clientId || !from || !to) {
    return { rows: [], userTotalsRows: [] };
  }

  return fetchOverviewViaApi({ clientId, from, to, ga4PropertyId, onCancelCheck });
}
