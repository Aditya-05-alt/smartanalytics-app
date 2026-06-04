const MAX_ENTRIES = 24;
const STALE_MS = 5 * 60 * 1000;
const store = new Map();

export function topCampaignsCacheKey(clientId, from, to, pageTypeFilter) {
  return `${clientId}|${from}|${to}|${pageTypeFilter}|campaigns-v1`;
}

export function getTopCampaignsCache(clientId, from, to, pageTypeFilter) {
  if (!clientId || !from || !to || !pageTypeFilter) return null;
  const entry = store.get(topCampaignsCacheKey(clientId, from, to, pageTypeFilter));
  if (!entry) return null;
  if (Date.now() - entry.at > STALE_MS) {
    store.delete(topCampaignsCacheKey(clientId, from, to, pageTypeFilter));
    return null;
  }
  return entry.rows;
}

export function setTopCampaignsCache(clientId, from, to, pageTypeFilter, rows) {
  if (!clientId || !from || !to || !pageTypeFilter) return;
  const k = topCampaignsCacheKey(clientId, from, to, pageTypeFilter);
  if (store.has(k)) store.delete(k);
  store.set(k, { rows: rows || [], at: Date.now() });
  while (store.size > MAX_ENTRIES) {
    store.delete(store.keys().next().value);
  }
}

export function hasTopCampaignsCache(clientId, from, to, pageTypeFilter) {
  return getTopCampaignsCache(clientId, from, to, pageTypeFilter) != null;
}
