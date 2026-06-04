/**
 * Session cache for channel breakdown by client + range + page type tab.
 */

const MAX_ENTRIES = 24;
const STALE_MS = 5 * 60 * 1000;
const store = new Map();

export function channelCacheKey(clientId, from, to, pageTypeFilter) {
  return `${clientId}|${from}|${to}|${pageTypeFilter}|v2`;
}

export function getChannelBreakdownCache(clientId, from, to, pageTypeFilter) {
  if (!clientId || !from || !to || !pageTypeFilter) return null;
  const k = channelCacheKey(clientId, from, to, pageTypeFilter);
  const entry = store.get(k);
  if (!entry) return null;
  if (Date.now() - entry.at > STALE_MS) {
    store.delete(k);
    return null;
  }
  return entry.rows;
}

export function setChannelBreakdownCache(clientId, from, to, pageTypeFilter, rows) {
  if (!clientId || !from || !to || !pageTypeFilter) return;
  const k = channelCacheKey(clientId, from, to, pageTypeFilter);
  if (store.has(k)) store.delete(k);
  store.set(k, { rows: rows || [], at: Date.now() });
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    store.delete(oldest);
  }
}

export function hasChannelBreakdownCache(clientId, from, to, pageTypeFilter) {
  return getChannelBreakdownCache(clientId, from, to, pageTypeFilter) != null;
}
