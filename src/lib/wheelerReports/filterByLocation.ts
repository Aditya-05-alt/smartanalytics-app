import type { AdStat, Lead, MediaSpend, OtherCost, Sale, Store } from './types';

type Rows = {
  stores: Store[];
  leads: Lead[];
  ads: AdStat[];
  media: MediaSpend[];
  sales: Sale[];
  other: OtherCost[];
};

/** Parse `location` query: `Name|Name` or legacy single name. Empty / all = no filter. */
export function parseLocationParam(
  raw: string | string[] | null | undefined,
  validNames: string[],
): string[] {
  const parts = (Array.isArray(raw) ? raw.join('|') : String(raw || ''))
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length || parts.some((p) => p === 'all' || p === 'All locations' || p === 'All stores')) {
    return [];
  }
  const allowed = new Set(validNames);
  return [...new Set(parts.filter((p) => allowed.has(p)))];
}

export function serializeLocations(names: string[]): string | null {
  const cleaned = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  if (!cleaned.length) return null;
  return cleaned.join('|');
}

/** Narrow report rows to one or more stores (by name). Empty = all locations. */
export function filterRowsByLocation<T extends Rows>(
  rows: T,
  locationNames: string | string[] | null | undefined,
): T {
  const names = (Array.isArray(locationNames) ? locationNames : [locationNames || ''])
    .map((n) => String(n || '').trim())
    .filter((n) => n && n !== 'all' && n !== 'All locations' && n !== 'All stores');
  if (!names.length) return rows;

  const ids = new Set(
    rows.stores.filter((s) => names.includes(s.name)).map((s) => s.id),
  );
  if (!ids.size) return rows;

  return {
    ...rows,
    stores: rows.stores.filter((s) => ids.has(s.id)),
    leads: rows.leads.filter((l) => l.store_id != null && ids.has(l.store_id)),
    ads: rows.ads.filter((a) => a.store_id != null && ids.has(a.store_id)),
    media: rows.media.filter((m) => ids.has(m.store_id)),
    sales: rows.sales.filter((s) => ids.has(s.store_id)),
    other: rows.other.filter((o) => o.store_id != null && ids.has(o.store_id)),
  };
}
