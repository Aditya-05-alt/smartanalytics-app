import { normalizeGa4PropertyId } from '@/lib/dealers/fields';

export function parsePropertyId(searchParams) {
  const raw =
    searchParams.get('propertyId')?.trim() ||
    searchParams.get('ga4PropertyId')?.trim();
  return raw ? normalizeGa4PropertyId(raw) || null : null;
}

export function analyticsExtraParams(propertyId) {
  const pid = propertyId ? normalizeGa4PropertyId(propertyId) : '';
  return pid ? { p_ga4_property_id: pid } : {};
}

export function mergeAnalyticsExtra(searchParams, base = {}) {
  return { ...base, ...analyticsExtraParams(parsePropertyId(searchParams)) };
}
