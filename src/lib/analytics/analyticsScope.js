import { normalizeGa4PropertyId } from '@/lib/dealers/fields';

/** GA4 property id for the selected dealer, or null when unscoped (legacy). */
export function clientGa4PropertyId(client) {
  const raw = client?.ga4PropertyId;
  if (raw == null || String(raw).trim() === '') return null;
  return normalizeGa4PropertyId(raw) || null;
}

/** Cache key: client id alone, or client|property when scoped. */
export function analyticsCacheKey(client) {
  const clientId = client?.ga4CustomerId;
  if (!clientId) return null;
  const propertyId = clientGa4PropertyId(client);
  return propertyId ? `${clientId}|${propertyId}` : String(clientId);
}

/** Extra RPC params for scoped analytics reads. */
export function analyticsRpcExtra(clientOrPropertyId) {
  const propertyId =
    typeof clientOrPropertyId === 'object'
      ? clientGa4PropertyId(clientOrPropertyId)
      : normalizeGa4PropertyId(clientOrPropertyId) || null;
  return propertyId ? { p_ga4_property_id: propertyId } : {};
}

/** Append propertyId to dashboard API query strings. */
export function appendAnalyticsScope(qs, { ga4PropertyId, client } = {}) {
  const propertyId =
    ga4PropertyId != null
      ? normalizeGa4PropertyId(ga4PropertyId) || null
      : clientGa4PropertyId(client);
  if (propertyId) qs.set('propertyId', propertyId);
  return qs;
}

/** Cache / RPC scope id — includes property when dealer is property-scoped. */
export function scopeCacheId(clientId, ga4PropertyId) {
  return (
    analyticsCacheKey({ ga4CustomerId: clientId, ga4PropertyId }) ||
    String(clientId || '').trim() ||
    null
  );
}

export function withPropertyRpcParams(params, ga4PropertyId) {
  const extra = analyticsRpcExtra(ga4PropertyId);
  return extra.p_ga4_property_id ? { ...params, ...extra } : params;
}

export function isPropertyScoped(ga4PropertyId) {
  return Boolean(clientGa4PropertyId({ ga4PropertyId }));
}
