// Meta Marketing API: daily campaign spend, impressions, clicks and lead actions
// for one ad account. Needs a long-lived (System User) access token with ads_read
// on the ad account. See README "Meta (Facebook) Ads API".
import { env } from '../env';
import { storeForCampaign } from '../campaigns';
import type { AdStat, Store } from '../types';

type Insight = {
  campaign_id: string;
  campaign_name: string;
  objective?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  actions?: { action_type: string; value: string }[];
  date_start: string;
  date_stop: string;
};

const OBJECTIVES: Record<string, string> = {
  OUTCOME_LEADS: 'Leads', OUTCOME_TRAFFIC: 'Traffic', OUTCOME_SALES: 'Sales', OUTCOME_AWARENESS: 'Awareness',
  OUTCOME_ENGAGEMENT: 'Engagement', OUTCOME_APP_PROMOTION: 'App promotion', LEAD_GENERATION: 'Leads', LINK_CLICKS: 'Traffic', CONVERSIONS: 'Sales',
};

export async function fetchMetaDaily(
  adAccountId: string,
  from: string,
  to: string,
  stores: Pick<Store, 'id' | 'campaign_terms' | 'sort'>[],
): Promise<AdStat[]> {
  const account = adAccountId.replace(/^act_/, '');
  const params = new URLSearchParams({
    level: 'campaign',
    time_increment: '1',
    time_range: JSON.stringify({ since: from, until: to }),
    fields: 'campaign_id,campaign_name,objective,spend,impressions,clicks,actions',
    limit: '500',
    access_token: env.meta.accessToken(),
  });
  let url: string | null = `https://graph.facebook.com/${env.meta.apiVersion()}/act_${account}/insights?${params}`;
  const leadTypes = env.meta.leadActionTypes();
  const out: AdStat[] = [];
  while (url) {
    const res: Response = await fetch(url);
    const body = (await res.json()) as { data?: Insight[]; paging?: { next?: string }; error?: { message: string; code: number } };
    if (!res.ok || body.error) throw new Error(`Meta API ${res.status}: ${body.error?.message ?? 'unknown error'}`);
    for (const r of body.data ?? []) {
      // First listed action type that is present (avoids counting the same lead twice).
      const lead = leadTypes.map((t) => r.actions?.find((a) => a.action_type === t)).find(Boolean);
      out.push({
        platform: 'meta',
        date_from: r.date_start,
        date_to: r.date_stop,
        campaign_id: r.campaign_id,
        campaign_name: r.campaign_name,
        channel: 'Facebook / Instagram',
        campaign_group: OBJECTIVES[r.objective ?? ''] ?? (r.objective || 'Meta'),
        store_id: storeForCampaign(r.campaign_name, stores),
        cost: Number(r.spend ?? 0),
        impressions: Number(r.impressions ?? 0),
        clicks: Number(r.clicks ?? 0),
        search_impression_share: null,
        platform_leads: lead ? Number(lead.value) : null,
        source: 'api',
      });
    }
    url = body.paging?.next ?? null;
  }
  return out;
}
