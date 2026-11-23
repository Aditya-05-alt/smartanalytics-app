import { describe, expect, it } from 'vitest';
import { daysIncl, monthsIn, overlapDays, parseLongRange, prorate, dateInZone } from '@/lib/wheelerReports/dates';

describe('dates', () => {
  it('counts days', () => { expect(daysIncl('2026-10-01', '2026-10-31')).toBe(31); expect(daysIncl('2026-11-01', '2026-11-01')).toBe(1); });
  it('overlaps', () => { expect(overlapDays('2026-10-01', '2026-10-31', '2026-10-25', '2026-11-05')).toBe(7); expect(overlapDays('2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04')).toBe(0); });
  it('prorates', () => expect(prorate('2026-11-01', '2026-11-15', '2026-11-01', '2026-11-07')).toBeCloseTo(7 / 15));
  it('lists months', () => expect(monthsIn('2026-10-20', '2026-12-02')).toEqual(['2026-10-01', '2026-11-01', '2026-12-01']));
  it('reads the Google Ads header', () => expect(parseLongRange('November 1, 2026 - November 15, 2026')).toEqual({ from: '2026-11-01', to: '2026-11-15' }));
  it('uses the client time zone', () => expect(dateInZone(new Date('2026-11-01T03:30:00Z'), 'America/New_York')).toBe('2026-10-31'));
});
