import type { Store } from '@/lib/wheelerReports/types';

// The A&L stores, as in supabase/seed_al_rv_sales.sql
export const AL_STORES: Store[] = [
  ['Jackson, TN', ['jackson'], ['Jackson']],
  ['Columbia, TN', ['columbia'], ['Columbia']],
  ['Christiana / Murfreesboro, TN', ['murfreesboro', 'christiana'], ['Murfreesboro', 'Christiana']],
  ['Sevierville, TN', ['sevierville'], ['Sevierville']],
  ['Johnson City, TN', ['johnson city', 'johnson_city', 'kodak'], ['Johnson City']],
  ['Richmond, VA', ['richmond', 'state va'], ['Richmond']],
  ['Lake Park, GA', ['lake park', 'lake_park', 'state ga'], ['Lake Park']],
  ['Greenville / Chocowinity, NC', ['greenville', 'chocowinity', 'state nc'], ['Greenville', 'Chocowinity']],
].map(([name, terms, locs], i) => ({
  id: 's' + (i + 1), client_id: 'c1', name: name as string, sort: i + 1,
  campaign_terms: terms as string[], lead_locations: locs as string[],
}));
export const storeId = (name: string) => AL_STORES.find((s) => s.name === name)?.id ?? null;
