// Google Ads API (REST): daily campaign cost, impressions, clicks and search
// impression share for one customer account.
// Needs: developer token, an OAuth client (id + secret) and a refresh token for a
// Google user with access to the account (or the Wheeler MCC). See README "Google Ads API".
import { env } from '../env';
import { channelFor, googleGroupFor, storeForCampaign } from '../campaigns';
import type { AdStat, Store } from '../types';

let cached: { token: string; expires: number } | null = null;

async function accessToken(): Promise<string> {
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: env.google.clientId(),
      client_secret: env.google.clientSecret(),
      refresh_token: env.google.refreshToken(),
    }),
  });
  const body = (await res.json()) as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
  if (!res.ok || !body.access_token) throw new Error(`Google OAuth failed: ${body.error_description || body.error || res.status}`);
  cached = { token: body.access_token, expires: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return cached.token;
}

type Row = {
  campaign: { id: string; name: string; advertisingChannelType?: string };
  segments: { date: string };
  metrics: { costMicros?: string; impressions?: string; clicks?: string; searchImpressionShare?: number };
};

export async function fetchGoogleAdsDaily(
  customerId: string,
  from: string,
  to: string,
  stores: Pick<Store, 'id' | 'campaign_terms' | 'sort'>[],
): Promise<AdStat[]> {
  const cid = customerId.replace(/-/g, '');
  const query = `
    SELECT campaign.id, campaign.name, campaign.advertising_channel_type, segments.date,
           metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.search_impression_share
    FROM campaign
    WHERE segments.date BETWEEN '${from}' AND '${to}' AND metrics.impressions > 0`;
  const headers: Record<string, string> = {
    authorization: `Bearer ${await accessToken()}`,
    'developer-token': env.google.developerToken(),
    'content-type': 'application/json',
  };
  const login = env.google.loginCustomerId();
  if (login) headers['login-customer-id'] = login;

  const url = `https://googleads.googleapis.com/${env.google.apiVersion()}/customers/${cid}/googleAds:searchStream`;
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ query }) });
  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 500);
    try { const j = JSON.parse(text); msg = JSON.stringify(j[0]?.error ?? j.error ?? j).slice(0, 500); } catch { /* keep text */ }
    throw new Error(`Google Ads API ${res.status}: ${msg}`);
  }
  const batches = JSON.parse(text) as { results?: Row[] }[];
  const out: AdStat[] = [];
  for (const b of batches) for (const r of b.results ?? []) {
    const channel = channelFor(r.campaign.name, r.campaign.advertisingChannelType);
    out.push({
      platform: 'google',
      date_from: r.segments.date,
      date_to: r.segments.date,
      campaign_id: String(r.campaign.id),
      campaign_name: r.campaign.name,
      channel,
      campaign_group: googleGroupFor(r.campaign.name, channel),
      store_id: storeForCampaign(r.campaign.name, stores),
      cost: Math.round(Number(r.metrics.costMicros ?? 0) / 10_000) / 100,
      impressions: Number(r.metrics.impressions ?? 0),
      clicks: Number(r.metrics.clicks ?? 0),
      search_impression_share: r.metrics.searchImpressionShare ?? null,
      platform_leads: null,
      source: 'api',
    });
  }
  return out;
}
