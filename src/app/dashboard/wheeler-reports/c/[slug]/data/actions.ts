'use server';
// Data entry for users who can see this client: uploads, monthly figures and "sync now".
// Auth is requireClient (RLS); writes use the service-role client.
import { revalidatePath } from 'next/cache';
import { requireClient } from '@/lib/wheelerReports/auth';
import { adminClient } from '@/lib/wheelerReports/supabase/server';
import { loadStores } from '@/lib/wheelerReports/data';
import { parseLeadExport } from '@/lib/wheelerReports/leadImport';
import { parseGoogleReport, readSheet } from '@/lib/wheelerReports/googleReportImport';
import { logRun, replaceAdStats, syncClient } from '@/lib/wheelerReports/sync';
import { isISODate, monthEnd } from '@/lib/wheelerReports/dates';
import type { Platform } from '@/lib/wheelerReports/types';

export type Result = { ok: boolean; message: string } | null;

const optDate = (v: FormDataEntryValue | null) => (isISODate(String(v || '')) ? String(v) : undefined);

async function setup(slug: string) {
  const { client } = await requireClient(slug);
  return { client, sb: adminClient() };
}

export async function uploadLeads(slug: string, _prev: Result, form: FormData): Promise<Result> {
  const { client, sb } = await setup(slug);
  const file = form.get('file');
  if (!(file instanceof File) || !file.size) return { ok: false, message: 'Choose the lead export CSV first.' };
  try {
    const stores = await loadStores(sb, client.id);
    const res = await logRun(sb, client.id, 'leads_upload', async () => {
      const imp = parseLeadExport(await file.text(), stores, client.timezone, { from: optDate(form.get('from')), to: optDate(form.get('to')) });
      for (let i = 0; i < imp.leads.length; i += 500) {
        const chunk = imp.leads.slice(i, i + 500).map((l) => ({ ...l, client_id: client.id, imported_at: new Date().toISOString() }));
        const { error } = await sb.from('wheeler_reports_leads').upsert(chunk, { onConflict: 'client_id,external_id' });
        if (error) throw new Error(error.message);
      }
      const unknown = Object.entries(imp.unknownLocations).map(([k, n]) => `${k} (${n})`).join(', ');
      const dates = imp.leads.length ? `${imp.leads.reduce((a, l) => (l.lead_date < a ? l.lead_date : a), '9999')} to ${imp.leads.reduce((a, l) => (l.lead_date > a ? l.lead_date : a), '0000')}` : '';
      return {
        rows: imp.leads.length,
        message: `${imp.leads.length} leads saved${dates ? ', ' + dates : ''}.` +
          (imp.skippedOutsideDates ? ` ${imp.skippedOutsideDates} outside the dates were skipped.` : '') +
          (unknown ? ` No store matched these locations: ${unknown}. Add them to a store's lead locations, then upload again.` : '') +
          (imp.badRows ? ` ${imp.badRows} rows had no Lead ID or date.` : ''),
      };
    });
    revalidatePath(`/dashboard/wheeler-reports/c/${slug}`, 'layout');
    return { ok: true, message: res.message ?? 'Saved.' };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function uploadGoogleReport(slug: string, _prev: Result, form: FormData): Promise<Result> {
  const { client, sb } = await setup(slug);
  const file = form.get('file');
  if (!(file instanceof File) || !file.size) return { ok: false, message: 'Choose the Google Ads campaign report first.' };
  try {
    const stores = await loadStores(sb, client.id);
    const rows = await readSheet({ name: file.name, buffer: await file.arrayBuffer() });
    const parsed = parseGoogleReport(rows, stores, { from: optDate(form.get('from')), to: optDate(form.get('to')) });
    const res = await logRun(sb, client.id, 'google_upload', () =>
      replaceAdStats(sb, client.id, 'google', parsed.from, parsed.to, async () => parsed.stats, { widen: false }));
    revalidatePath(`/dashboard/wheeler-reports/c/${slug}`, 'layout');
    const unassigned = parsed.stats.filter((s) => !s.store_id).length;
    return { ok: true, message: `${res.rows} campaigns saved for ${parsed.from} to ${parsed.to} (any earlier Google Ads figures for those dates were replaced). ${unassigned} campaigns are shared (no single store).` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** Media spend, Facebook spend (when Meta isn't connected) and sales, per store, for one month. */
export async function saveMonthly(slug: string, _prev: Result, form: FormData): Promise<Result> {
  const { client, sb } = await setup(slug);
  const month = String(form.get('month') || '');
  if (!/^\d{4}-\d{2}-01$/.test(month)) return { ok: false, message: 'Choose a month.' };
  const end = monthEnd(month);
  const stores = await loadStores(sb, client.id);
  const val = (name: string) => { const v = String(form.get(name) ?? '').trim(); return v === '' ? null : Number(v); };
  try {
    for (const s of stores) {
      const media = val(`media_${s.id}`), fb = val(`fb_${s.id}`), sales = val(`sales_${s.id}`);
      for (const v of [media, fb, sales]) if (v != null && (!Number.isFinite(v) || v < 0)) throw new Error(`Check the numbers for ${s.name}.`);

      if (media == null) await sb.from('wheeler_reports_media_spend').delete().eq('client_id', client.id).eq('store_id', s.id).eq('month', month);
      else await sb.from('wheeler_reports_media_spend').upsert({ client_id: client.id, store_id: s.id, month, amount: media }, { onConflict: 'client_id,store_id,month' });

      if (sales == null) await sb.from('wheeler_reports_sales').delete().eq('client_id', client.id).eq('store_id', s.id).eq('date_from', month).eq('date_to', end);
      else await sb.from('wheeler_reports_sales').upsert({ client_id: client.id, store_id: s.id, date_from: month, date_to: end, units: sales }, { onConflict: 'client_id,store_id,date_from,date_to' });

      const manualId = 'manual-' + s.id;
      await sb.from('wheeler_reports_ad_stats').delete().eq('client_id', client.id).eq('platform', 'meta').eq('campaign_id', manualId).eq('date_from', month).eq('date_to', end);
      if (fb != null && fb > 0) {
        const { error } = await sb.from('wheeler_reports_ad_stats').insert({
          client_id: client.id, platform: 'meta', date_from: month, date_to: end, campaign_id: manualId, campaign_name: 'Facebook spend (entered by hand)',
          channel: 'Facebook', campaign_group: 'Manual', store_id: s.id, cost: fb, source: 'manual',
        });
        if (error) throw new Error(error.message);
      }
    }
    revalidatePath(`/dashboard/wheeler-reports/c/${slug}`, 'layout');
    return { ok: true, message: 'Saved. The report uses these figures right away.' };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function syncNow(slug: string, _prev: Result, form: FormData): Promise<Result> {
  const { client, sb } = await setup(slug);
  const platform = String(form.get('platform')) as Platform;
  const from = optDate(form.get('from')), to = optDate(form.get('to'));
  const res = await syncClient(sb, client, platform === 'meta' ? ['meta'] : ['google'], from && to ? { from, to } : undefined);
  revalidatePath(`/dashboard/wheeler-reports/c/${slug}`, 'layout');
  return { ok: res.every((r) => r.ok), message: res.map((r) => `${r.platform === 'google' ? 'Google Ads' : 'Meta Ads'}: ${r.message}`).join(' ') };
}
