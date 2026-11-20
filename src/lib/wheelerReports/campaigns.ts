// How a campaign is assigned to a store and a campaign group, from its name.
// Wheeler's naming convention: "WA | <Type> | <Theme> | <Location> | ..."
//   WA | Search | Manufacturer_Brinkley | TN Jackson   -> Search | Manufacturer, Jackson
//   WA | PMAX | Generic | NC Greenville                -> PMax | Generic, Greenville
//   WA | VLA | VA Richmond                             -> VLA, Richmond
//   WA | Display | All Locations (Except LP) | ...     -> Display, shared
import type { Store } from './types';

export const SHARED_LABEL = 'All locations (shared campaigns)';

const parts = (name: string) => name.split('|').map((p) => p.trim()).filter(Boolean);

/** Readable channel from a Google Ads advertising_channel_type or the name. */
export function channelFor(name: string, apiChannel?: string | null): string {
  const map: Record<string, string> = {
    SEARCH: 'Search', PERFORMANCE_MAX: 'Performance Max', DISPLAY: 'Display', VIDEO: 'Video',
    SHOPPING: 'Shopping', DEMAND_GEN: 'Demand Gen', DISCOVERY: 'Demand Gen', LOCAL: 'Local', SMART: 'Smart', HOTEL: 'Hotel', MULTI_CHANNEL: 'App',
  };
  if (apiChannel && map[apiChannel]) return map[apiChannel];
  const kind = (parts(name)[1] || '').toUpperCase();
  if (kind === 'SEARCH') return 'Search';
  if (kind === 'PMAX' || kind === 'VLA') return 'Performance Max';
  if (kind === 'DISPLAY') return 'Display';
  if (kind === 'VIDEO' || kind === 'YOUTUBE') return 'Video';
  return apiChannel ? apiChannel.charAt(0) + apiChannel.slice(1).toLowerCase().replace(/_/g, ' ') : 'Other';
}

/** Campaign group used in the "Google Ads by campaign group" table. */
export function googleGroupFor(name: string, channel: string): string {
  const p = parts(name);
  const kind = (p[1] || '').toUpperCase();
  if (kind === 'SEARCH' && p[2]) return 'Search | ' + (p[2].startsWith('Manufacturer') ? 'Manufacturer' : p[2]);
  if (kind === 'PMAX') return 'PMax | ' + (/get direction/i.test(name) ? 'Get Directions' : p[2] || 'Other');
  if (kind === 'VLA') return 'VLA';
  if (kind === 'DISPLAY') return 'Display';
  return channel || 'Other';
}

/**
 * Store whose campaign term appears in the name; null for shared campaigns
 * ("All Locations", a state-wide campaign covering several stores, or no match).
 */
export function storeForCampaign(name: string, stores: Pick<Store, 'id' | 'campaign_terms' | 'sort'>[]): string | null {
  const low = name.toLowerCase();
  if (low.includes('all locations')) return null;
  const sorted = [...stores].sort((a, b) => a.sort - b.sort);
  for (const s of sorted) if (s.campaign_terms.some((t) => t && low.includes(t.toLowerCase()))) return s.id;
  return null;
}
