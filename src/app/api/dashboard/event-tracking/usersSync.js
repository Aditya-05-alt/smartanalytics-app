/** Dealers per smart-ga4-total-users call (the page shows progress per chunk). */
export const USERS_SYNC_CHUNK = 10;
/** Periods ending this close to today are re-fetched once their users are this old. */
const RECENT_PERIOD_DAYS = 3;
const RECENT_USERS_MAX_AGE_MS = 12 * 60 * 60 * 1000;

function daysAgoISO(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

/**
 * GA4 total users are not additive across days, so each date range is its own GA4 period in
 * smart_events_users. Returns the dealers with no users for this exact range, or with stale
 * users for a range that is still settling.
 */
export async function findClientsNeedingUsers(supabase, from, to, clientIds) {
  const { data: stored, error } = await supabase
    .from('smart_events_users')
    .select('client_id, created_at')
    .eq('period_from', from)
    .eq('period_to', to)
    .eq('channel', '(all)')
    .in('client_id', clientIds);
  if (error) throw error;

  const settling = to >= daysAgoISO(RECENT_PERIOD_DAYS);
  const fresh = new Set(
    (stored || [])
      .filter(
        (row) =>
          !settling || Date.now() - Date.parse(row.created_at) < RECENT_USERS_MAX_AGE_MS
      )
      .map((row) => String(row.client_id))
  );
  return clientIds.filter((id) => !fresh.has(id));
}

/** Fetch GA4 total users for these dealers (smart-ga4-total-users stores them). */
export async function syncUsers(supabase, from, to, clientIds) {
  const chunks = [];
  for (let i = 0; i < clientIds.length; i += USERS_SYNC_CHUNK) {
    chunks.push(clientIds.slice(i, i + USERS_SYNC_CHUNK));
  }
  const results = await Promise.allSettled(
    chunks.map((chunk) =>
      supabase.functions.invoke('smart-ga4-total-users', {
        body: { client_ids: chunk, date_from: from, date_to: to },
      })
    )
  );
  const errors = [];
  for (const result of results) {
    const failure = result.status === 'rejected' ? result.reason : result.value?.error;
    if (failure) errors.push(failure?.message || String(failure));
  }
  if (errors.length) console.error('[event-tracking] users sync failed:', errors.join('; '));
  return errors;
}
