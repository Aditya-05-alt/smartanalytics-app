// Loads the rows a report needs for a client and date range.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { monthStart } from './dates';
import type { AdStat, Lead, MediaSpend, OtherCost, Sale, Store } from './types';

const PAGE = 1000;

/** Supabase returns at most 1000 rows per request: page through everything. */
async function all<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; ; i += PAGE) {
    const { data, error } = await build(i, i + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

export async function loadStores(sb: SupabaseClient, clientId: string): Promise<Store[]> {
  const { data, error } = await sb.from('wheeler_reports_stores').select('*').eq('client_id', clientId).order('sort');
  if (error) throw new Error(error.message);
  return (data ?? []) as Store[];
}

export async function loadReportRows(sb: SupabaseClient, clientId: string, from: string, to: string) {
  const [stores, leads, ads, media, sales, other] = await Promise.all([
    loadStores(sb, clientId),
    all<Lead>((a, b) => sb.from('wheeler_reports_leads').select('external_id, store_id, lead_date, source, medium, campaign, lead_type, form')
      .eq('client_id', clientId).gte('lead_date', from).lte('lead_date', to).order('lead_date').range(a, b)),
    all<AdStat>((a, b) => sb.from('wheeler_reports_ad_stats').select('platform, date_from, date_to, campaign_id, campaign_name, channel, campaign_group, store_id, cost, impressions, clicks, search_impression_share, platform_leads, source')
      .eq('client_id', clientId).lte('date_from', to).gte('date_to', from).order('date_from').range(a, b)),
    all<MediaSpend>((a, b) => sb.from('wheeler_reports_media_spend').select('store_id, month, amount').eq('client_id', clientId).gte('month', monthStart(from)).lte('month', to).range(a, b)),
    all<Sale>((a, b) => sb.from('wheeler_reports_sales').select('store_id, date_from, date_to, units').eq('client_id', clientId).lte('date_from', to).gte('date_to', from).range(a, b)),
    all<OtherCost>((a, b) => sb.from('wheeler_reports_other_costs').select('id, store_id, month, head, amount, created_at').eq('client_id', clientId).gte('month', monthStart(from)).lte('month', to).range(a, b)),
  ]);
  // numeric columns arrive as strings from PostgREST
  const n = (v: unknown) => (v == null ? null : Number(v));
  return {
    stores,
    leads,
    ads: ads.map((r) => ({ ...r, cost: Number(r.cost), impressions: Number(r.impressions), clicks: Number(r.clicks), search_impression_share: n(r.search_impression_share), platform_leads: n(r.platform_leads) })),
    media: media.map((r) => ({ ...r, amount: Number(r.amount) })),
    sales: sales.map((r) => ({ ...r, units: Number(r.units) })),
    other: other.map((r) => ({ ...r, amount: Number(r.amount) })),
  };
}
