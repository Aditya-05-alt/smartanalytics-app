// Lead source buckets used across the report.
import type { Lead } from './types';

export const SOURCE_COLUMNS = [
  { key: 'google_ads', label: 'Google Ads' },
  { key: 'google_organic', label: 'Google organic' },
  { key: 'google_business', label: 'Google Business Profile' },
  { key: 'direct', label: 'Direct' },
  { key: 'rv_trader', label: 'RV Trader' },
  { key: 'facebook', label: 'Facebook' },
  { key: 'bing_ads', label: 'Bing Ads' },
  { key: 'other_search', label: 'Other search' },
  { key: 'ai', label: 'ChatGPT / AI' },
  { key: 'email', label: 'Email' },
  { key: 'other_referral', label: 'Other referral' },
] as const;
export type SourceKey = (typeof SOURCE_COLUMNS)[number]['key'];

export const isGoogleAds = (l: Pick<Lead, 'source' | 'medium'>) => l.source.toLowerCase() === 'google' && l.medium.toLowerCase() === 'cpc';
export const isMeta = (l: Pick<Lead, 'source'>) => /^facebook/i.test(l.source.trim());

export function sourceBucket(l: Pick<Lead, 'source' | 'medium' | 'campaign'>): SourceKey {
  const s = l.source.toLowerCase().trim();
  const m = l.medium.toLowerCase().trim();
  if (s === 'google' && m === 'cpc') return 'google_ads';
  if (s === 'google' && m === 'organic') return l.campaign.startsWith('google_my_business') ? 'google_business' : 'google_organic';
  if (s === '(direct)' || s === 'direct') return 'direct';
  if (s.startsWith('rvtrader')) return 'rv_trader';
  if (s.startsWith('facebook')) return 'facebook';
  if (s === 'bing' && m === 'cpc') return 'bing_ads';
  if (s === 'chatgpt.com' || s.includes('openai') || s.includes('perplexity')) return 'ai';
  if (m === 'organic') return 'other_search';
  if (m === 'email') return 'email';
  return 'other_referral';
}

/** Sources hidden from Leads-by-store totals (column stays visible at 0). Facebook is counted. */
export function isExcludedLeadSource(l: Pick<Lead, 'source'>): boolean {
  return l.source.toLowerCase().trim().startsWith('rvtrader');
}

/** Form names grouped the way the report shows them. */
export const FORM_GROUPS: Record<string, string> = {
  'Sell My RV': 'Sell My RV / Trade-In / Consignment',
  'Trade-In': 'Sell My RV / Trade-In / Consignment',
  Consignment: 'Sell My RV / Trade-In / Consignment',
  'Srp No Match': 'Other (Srp No Match, Custom Form)',
  'Custom Form': 'Other (Srp No Match, Custom Form)',
};
export const formGroup = (form: string) => FORM_GROUPS[form] || form || 'Unknown';
