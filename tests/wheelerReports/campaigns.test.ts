import { describe, expect, it } from 'vitest';
import { channelFor, googleGroupFor, storeForCampaign } from '@/lib/wheelerReports/campaigns';
import { AL_STORES, storeId } from './helpers';

describe('campaign naming', () => {
  it.each([
    ['WA | Search | Manufacturer_Brinkley | TN Jackson', 'Search', 'Search | Manufacturer', 'Jackson, TN'],
    ['WA | Search | Brand | Lake Park, FL', 'Search', 'Search | Brand', 'Lake Park, GA'],
    ['WA | PMAX | Generic | NC Greenville', 'Performance Max', 'PMax | Generic', 'Greenville / Chocowinity, NC'],
    ['WA | PMAX | All Locations | Get Direction Goal', 'Performance Max', 'PMax | Get Directions', null],
    ['WA | VLA | API FEED | September 2026 | Johnson city', 'Performance Max', 'VLA', 'Johnson City, TN'],
    ['WA | Display | All Locations (Except LP) | Insider Pricing Event', 'Display', 'Display', null],
    ['WA | Display | State VA | RV Closeout | November 2026', 'Display', 'Display', 'Richmond, VA'],
    ['WA | Display | State TN | RV Closeout | November 2026', 'Display', 'Display', null],
  ])('%s', (name, channel, group, store) => {
    const ch = channelFor(name);
    expect(ch).toBe(channel);
    expect(googleGroupFor(name, ch)).toBe(group);
    expect(storeForCampaign(name, AL_STORES)).toBe(store ? storeId(store) : null);
  });
  it('prefers the API channel', () => expect(channelFor('Anything', 'PERFORMANCE_MAX')).toBe('Performance Max'));
});
