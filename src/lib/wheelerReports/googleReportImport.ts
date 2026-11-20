// Fallback for when the Google Ads API isn't connected: the "Campaign report"
// downloaded from Google Ads (xlsx or csv). Row 1 = title, row 2 = date range,
// then a header row with Campaign, Cost, Impr., Clicks, Search impr. share, Campaign ID.
import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import { channelFor, googleGroupFor, storeForCampaign } from './campaigns';
import { parseLongRange } from './dates';
import type { AdStat, Store } from './types';

type Cell = string | number | null;

export async function readSheet(file: { name: string; buffer: ArrayBuffer }): Promise<Cell[][]> {
  if (/\.xlsx$/i.test(file.name)) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file.buffer);
    const ws = wb.worksheets[0];
    const rows: Cell[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const vals = (row.values as unknown[]).slice(1).map((v): Cell => {
        if (v == null) return null;
        if (typeof v === 'number' || typeof v === 'string') return v;
        if (v instanceof Date) return v.toISOString().slice(0, 10);
        if (typeof v === 'object' && v && 'result' in v) return (v as { result: Cell }).result ?? null;
        if (typeof v === 'object' && v && 'text' in v) return String((v as { text: unknown }).text);
        return String(v);
      });
      rows.push(vals);
    });
    return rows;
  }
  const text = new TextDecoder('utf-8').decode(file.buffer).replace(/^﻿/, '');
  // Google Ads CSV downloads are sometimes UTF-16 / tab separated.
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true });
  return parsed.data.map((r) => r.map((c) => (c === '' ? null : c)));
}

const num = (v: Cell): number => {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  const s = v.replace(/[$,\s]/g, '');
  if (s === '--' || s === '') return 0;
  return Number(s.replace('%', '')) / (s.endsWith('%') ? 100 : 1) || 0;
};
const share = (v: Cell): number | null => {
  if (v == null || v === '--' || v === '') return null;
  if (typeof v === 'number') return v > 1 ? v / 100 : v;
  const s = v.trim();
  if (s.startsWith('<')) return 0.0999; // Google shows "< 10%"
  if (s.startsWith('>')) return 0.9;
  const n = num(s);
  return n > 1 ? n / 100 : n;
};

export function parseGoogleReport(
  rows: Cell[][],
  stores: Pick<Store, 'id' | 'campaign_terms' | 'sort'>[],
  range?: { from?: string; to?: string },
): { stats: AdStat[]; from: string; to: string; skipped: number } {
  let from = range?.from, to = range?.to;
  if (!from || !to) {
    for (const r of rows.slice(0, 5)) {
      const found = r.map((c) => (typeof c === 'string' ? parseLongRange(c) : null)).find(Boolean);
      if (found) { from = from || found.from; to = to || found.to; break; }
    }
  }
  if (!from || !to) throw new Error('Could not find the report dates. Enter the From and To dates for this report.');

  const h = rows.findIndex((r) => r.some((c) => c === 'Campaign') && r.some((c) => c === 'Cost'));
  if (h < 0) throw new Error('Could not find a header row with "Campaign" and "Cost". Use the Google Ads Campaign report.');
  const head = rows[h].map((c) => String(c ?? '').trim());
  const ix = (...names: string[]) => names.map((n) => head.indexOf(n)).find((i) => i >= 0) ?? -1;
  const iName = ix('Campaign'), iId = ix('Campaign ID'), iCost = ix('Cost'), iImpr = ix('Impr.', 'Impressions'),
    iClicks = ix('Clicks'), iIS = ix('Search impr. share', 'Search Impr. share'), iType = ix('Campaign type');

  const stats: AdStat[] = [];
  let skipped = 0;
  for (const r of rows.slice(h + 1)) {
    const first = String(r[0] ?? '');
    const name = String(r[iName] ?? '').trim();
    if (!name || /^total/i.test(first) || /^total/i.test(name)) { skipped++; continue; }
    const cost = num(r[iCost]), impressions = Math.round(num(r[iImpr])), clicks = Math.round(num(r[iClicks]));
    if (cost <= 0 && impressions <= 0) { skipped++; continue; }
    const apiType = iType >= 0 ? String(r[iType] ?? '').toUpperCase().replace(/\s+/g, '_') : null;
    const channel = channelFor(name, apiType);
    stats.push({
      platform: 'google',
      date_from: from,
      date_to: to,
      campaign_id: iId >= 0 && r[iId] != null ? String(r[iId]).trim() : 'name:' + name,
      campaign_name: name,
      channel,
      campaign_group: googleGroupFor(name, channel),
      store_id: storeForCampaign(name, stores),
      cost: Math.round(cost * 100) / 100,
      impressions,
      clicks,
      search_impression_share: iIS >= 0 ? share(r[iIS]) : null,
      platform_leads: null,
      source: 'upload',
    });
  }
  return { stats, from, to, skipped };
}
