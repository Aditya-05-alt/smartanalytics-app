// Shared row types (mirror the Supabase tables in supabase/migrations).

export type Client = {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  google_ads_customer_id: string | null;
  meta_ad_account_id: string | null;
};

export type Store = {
  id: string;
  client_id: string;
  name: string;
  sort: number;
  campaign_terms: string[];
  lead_locations: string[];
};

export type Lead = {
  external_id: string;
  store_id: string | null;
  lead_date: string; // YYYY-MM-DD in the client's time zone
  source: string;
  medium: string;
  campaign: string;
  lead_type: string;
  form: string;
  /** Display name from Scout export; email/phone are never stored. */
  contact_name?: string;
};

export type Platform = 'google' | 'meta';

export type AdStat = {
  platform: Platform;
  date_from: string;
  date_to: string;
  campaign_id: string;
  campaign_name: string;
  channel: string;
  campaign_group: string;
  store_id: string | null; // null = shared across stores
  cost: number;
  impressions: number;
  clicks: number;
  search_impression_share: number | null;
  platform_leads: number | null;
  source: 'api' | 'upload' | 'manual';
};

export type MediaSpend = { store_id: string; month: string; amount: number };
export type Sale = { store_id: string; date_from: string; date_to: string; units: number };
export type OtherCost = {
  id?: string;
  store_id: string | null; // null = all stores
  month: string; // YYYY-MM-01
  head: string;
  amount: number;
  created_at?: string;
};
