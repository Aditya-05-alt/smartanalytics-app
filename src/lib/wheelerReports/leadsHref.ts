/** Build the in-report leads list URL with optional filters. */
export type LeadsHrefFilters = {
  store?: string;
  channel?: 'facebook' | 'google' | 'all';
  source?: string;
  form?: string;
  campaign?: string;
  group?: string;
  leadType?: 'unlock_price' | 'financing' | 'other';
};

export function leadsHref(
  slug: string,
  from: string,
  to: string,
  filters: LeadsHrefFilters = {},
): string {
  const q = new URLSearchParams({ from, to });
  if (filters.channel) q.set('channel', filters.channel);
  if (filters.store) q.set('store', filters.store);
  if (filters.source) q.set('source', filters.source);
  if (filters.form) q.set('form', filters.form);
  if (filters.campaign) q.set('campaign', filters.campaign);
  if (filters.group) q.set('group', filters.group);
  if (filters.leadType) q.set('lead_type', filters.leadType);
  return `/dashboard/wheeler-reports/c/${slug}/report/leads?${q}`;
}
