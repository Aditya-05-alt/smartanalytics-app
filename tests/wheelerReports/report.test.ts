import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import Papa from 'papaparse';
import { buildReport } from '@/lib/wheelerReports/report';
import { parseLeadExport } from '@/lib/wheelerReports/leadImport';
import { parseGoogleReport, readSheet } from '@/lib/wheelerReports/googleReportImport';
import type { AdStat, Lead, OtherCost } from '@/lib/wheelerReports/types';
import { AL_STORES, storeId } from './helpers';

const base = { stores: AL_STORES, leads: [] as Lead[], ads: [] as AdStat[], media: [], sales: [], other: [] as OtherCost[] };
const ad = (p: Partial<AdStat>): AdStat => ({
  platform: 'google', date_from: '2026-11-01', date_to: '2026-11-15', campaign_id: '1', campaign_name: 'x', channel: 'Search',
  campaign_group: 'Search | Brand', store_id: 's1', cost: 150, impressions: 1500, clicks: 150, search_impression_share: 0.5,
  platform_leads: null, source: 'upload', ...p,
});
const lead = (p: Partial<Lead>): Lead => ({ external_id: Math.random().toString(36), store_id: 's1', lead_date: '2026-11-03', source: 'google', medium: 'cpc', campaign: '1', lead_type: 'unlock_price', form: 'Price Unlock', ...p });

describe('buildReport (synthetic)', () => {
  it('spreads a period over its days and adds other costs', () => {
    const r = buildReport({ ...base, from: '2026-11-01', to: '2026-11-05', ads: [ad({})], leads: [lead({}), lead({ source: '(direct)', medium: '(none)' })],
      other: [{ store_id: 's1', month: '2026-11-01', head: 'Billboard', amount: 300 }] });
    expect(r.kpis.google_spend).toBeCloseTo(50);         // 150 × 5/15
    expect(r.kpis.total_spend).toBeCloseTo(50 + 50);     // + 300 × 5/30
    expect(r.kpis.leads).toBe(2);
    expect(r.kpis.google_leads).toBe(1);
    expect(r.leadsByStore.find((x) => x.store === 'Jackson, TN')?.direct).toBe(1);
    expect(r.otherByHead[0]).toMatchObject({ head: 'Billboard', entries: 1 });
  });
  it('uses media spend for a month when entered', () => {
    const r = buildReport({ ...base, from: '2026-10-01', to: '2026-10-31', ads: [ad({ date_from: '2026-10-01', date_to: '2026-10-31' })],
      media: [{ store_id: 's1', month: '2026-10-01', amount: 1000 }] });
    expect(r.kpis.total_spend).toBeCloseTo(1000);
    expect(r.basis).toEqual([{ month: '2026-10-01', kind: 'media' }]);
  });
  it('puts shared campaigns and their leads in their own row', () => {
    const r = buildReport({ ...base, from: '2026-11-01', to: '2026-11-15', ads: [ad({ campaign_id: '9', store_id: null })], leads: [lead({ campaign: '9' })] });
    expect(r.googleByStore.find((x) => x.store.startsWith('All locations'))).toMatchObject({ leads: 1 });
  });
});

// Checks against the October and November figures of the original dashboard,
// when the real files are available (they hold client data, so they aren't in the repo):
//   FIXTURE_DIR=/path/to/files npm test
const dir = process.env.FIXTURE_DIR;
describe.skipIf(!dir)('buildReport (A&L real data)', () => {
  const read = (f: string) => fs.readFileSync(path.join(dir!, f), 'utf8');
  const oct = Papa.parse<Record<string, string>>(read('oct_leads.csv'), { header: true, skipEmptyLines: true }).data;
  const octLeads: Lead[] = oct.map((l) => {
    const [source, medium] = l.source_medium.split(' / ');
    return { external_id: l.lead, store_id: storeId(l.store), lead_date: l.date, source, medium, campaign: l.campaign, lead_type: l.lead_type, form: l.form };
  });
  const octGoogle: AdStat[] = Papa.parse<Record<string, string>>(read('oct_google.csv'), { header: true, skipEmptyLines: true }).data.map((c) => ad({
    date_from: '2026-10-01', date_to: '2026-10-31', campaign_id: c.campaign_id, campaign_name: c.campaign, channel: c.campaign_type,
    campaign_group: c.group, store_id: c.store.startsWith('All locations') ? null : storeId(c.store), cost: +c.cost, impressions: +c.impressions,
    clicks: +c.clicks, search_impression_share: c.search_is ? +c.search_is : null,
  }));
  const media = [8791.30, 4835.96, 5533.57, 5983.64, 6382.75, 6645.65, 6886.45, 4981.09].map((amount, i) => ({
    store_id: storeId(['Christiana / Murfreesboro, TN', 'Columbia, TN', 'Greenville / Chocowinity, NC', 'Jackson, TN', 'Johnson City, TN', 'Lake Park, GA', 'Richmond, VA', 'Sevierville, TN'][i])!, month: '2026-10-01', amount,
  }));
  const fb = [1871.97, 1128.78, 1160.95, 1297.07, 1446.08, 1306.33, 1268.28, 1162.77].map((cost, i) => ad({
    platform: 'meta', date_from: '2026-10-01', date_to: '2026-10-31', campaign_id: 'manual-' + i, channel: 'Facebook', campaign_group: 'Manual', search_impression_share: null,
    store_id: storeId(['Christiana / Murfreesboro, TN', 'Columbia, TN', 'Greenville / Chocowinity, NC', 'Jackson, TN', 'Johnson City, TN', 'Lake Park, GA', 'Richmond, VA', 'Sevierville, TN'][i]), cost,
  }));
  const other: OtherCost[] = [
    ['Christiana / Murfreesboro, TN', 'All Other Wheeler Fees', 2722.5], ['Columbia, TN', 'All Other Wheeler Fees', 1922.5], ['Greenville / Chocowinity, NC', 'All Other Wheeler Fees', 1922.5],
    ['Johnson City, TN', 'All Other Wheeler Fees', 1922.5], ['Lake Park, GA', 'All Other Wheeler Fees', 1922.5], ['Richmond, VA', 'All Other Wheeler Fees', 1922.5],
    ['Sevierville, TN', 'All Other Wheeler Fees', 1922.5], ['Jackson, TN', 'All Other Wheeler Fees', 1922.5], ['Richmond, VA', 'Streaming Video', 1700], ['Columbia, TN', 'Billboard', 500],
  ].map(([s, head, amount]) => ({ store_id: storeId(s as string), month: '2026-10-01', head: head as string, amount: amount as number }));

  it('October matches the original dashboard', () => {
    const r = buildReport({ ...base, from: '2026-10-01', to: '2026-10-31', leads: octLeads, ads: [...octGoogle, ...fb], media, other });
    expect(r.kpis.total_spend).toBeCloseTo(68420.41, 1);
    expect(r.kpis.leads).toBe(997);
    expect(r.kpis.google_spend).toBeCloseTo(37198.97, 1);
    expect(r.kpis.google_leads).toBe(371);
    expect(r.kpis.meta_spend).toBeCloseTo(10642.23, 1);
    expect(r.kpis.meta_leads).toBe(45);
    expect(r.leadsByStore.find((x) => x.store === 'Jackson, TN')?.total_spend).toBeCloseTo(7906.14, 1);
    expect(r.otherByHead[0]).toMatchObject({ head: 'All Other Wheeler Fees', entries: 8 });
    expect(r.googleByGroup.find((g) => g.group === 'All campaigns')?.campaigns).toBe(95);
  });

  it('November 1–15 imports the raw files and matches', async () => {
    const imp = parseLeadExport(read('nov_leads_raw.csv'), AL_STORES, 'America/New_York', { from: '2026-11-01', to: '2026-11-15' });
    expect(imp.leads.length).toBe(284);
    expect(imp.skippedOutsideDates).toBe(13);
    expect(imp.unknownLocations).toEqual({});
    const buf = fs.readFileSync(path.join(dir!, 'nov_google.xlsx'));
    const rows = await readSheet({ name: 'nov_google.xlsx', buffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer });
    const g = parseGoogleReport(rows, AL_STORES);
    expect(g.from).toBe('2026-11-01');
    expect(g.to).toBe('2026-11-15');
    expect(g.stats.filter((s) => s.cost > 0).length).toBe(86); // plus 2 with impressions but no cost
    const r = buildReport({ ...base, from: '2026-11-01', to: '2026-11-15', leads: imp.leads, ads: g.stats });
    expect(r.kpis.total_spend).toBeCloseTo(14224.94, 1);
    expect(r.kpis.leads).toBe(284);
    expect(r.kpis.google_leads).toBe(97);
    expect(r.googleByStore.find((x) => x.store === 'Jackson, TN')?.spend).toBeCloseTo(1960.48, 1);
    expect(r.googleByGroup.find((x) => x.group === 'Search | Brand')?.leads).toBe(30);
    expect(r.leadsByForm.find((x) => x.form === 'Price Unlock')?.leads).toBe(121);
    // first week only: Google cost is 7/15 of the period
    const w = buildReport({ ...base, from: '2026-11-01', to: '2026-11-07', leads: imp.leads, ads: g.stats });
    expect(w.kpis.google_spend).toBeCloseTo(14224.94 * 7 / 15, 1);
  });
});
