// Writes ad platform rows into ad_stats, replacing what was there for the same dates.
// Used by the API sync (Google Ads, Meta) and by the Google Ads report upload.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { addDays, todayInZone } from './dates';
import { env } from './env';
import { loadStores } from './data';
import { fetchGoogleAdsDaily } from './integrations/googleAds';
import { fetchMetaDaily } from './integrations/metaAds';
import type { AdStat, Client, Platform } from './types';

const CHUNK = 500;

/**
 * Replace a platform's rows for [from, to] with `rows`.
 * Rows that only partly overlap the dates (e.g. a monthly upload when a daily sync starts
 * mid-month) widen the range so nothing is counted twice; the caller must then supply
 * data for the widened range, which is why `fetchFor` is passed in. An upload can't fetch
 * more data, so it passes widen: false and is refused instead.
 */
export async function replaceAdStats(
  sb: SupabaseClient,
  clientId: string,
  platform: Platform,
  from: string,
  to: string,
  fetchFor: (from: string, to: string) => Promise<AdStat[]>,
  opts: { widen: boolean } = { widen: true },
): Promise<{ rows: number; from: string; to: string }> {
  let f = from, t = to;
  for (let i = 0; i < 5; i++) {
    const { data, error } = await sb.from('wheeler_reports_ad_stats').select('date_from, date_to').eq('client_id', clientId).eq('platform', platform)
      .lte('date_from', t).gte('date_to', f).or(`date_from.lt.${f},date_to.gt.${t}`);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    if (!opts.widen) {
      const r = data[0];
      throw new Error(`Saved ${platform} figures for ${r.date_from} to ${r.date_to} only partly overlap ${from} to ${to}. Upload a report for exactly that period, or one that doesn't overlap it.`);
    }
    for (const r of data) { if (r.date_from < f) f = r.date_from; if (r.date_to > t) t = r.date_to; }
  }
  const rows = await fetchFor(f, t);
  const { error: delErr } = await sb.from('wheeler_reports_ad_stats').delete().eq('client_id', clientId).eq('platform', platform).gte('date_from', f).lte('date_to', t);
  if (delErr) throw new Error(delErr.message);
  // Merge duplicates (same campaign and dates) that a report can contain.
  const merged = new Map<string, AdStat>();
  for (const r of rows) {
    const k = `${r.campaign_id}|${r.date_from}|${r.date_to}`;
    const m = merged.get(k);
    if (m) { m.cost += r.cost; m.impressions += r.impressions; m.clicks += r.clicks; } else merged.set(k, { ...r });
  }
  const list = [...merged.values()].map((r) => ({ ...r, client_id: clientId, updated_at: new Date().toISOString() }));
  for (let i = 0; i < list.length; i += CHUNK) {
    const { error } = await sb.from('wheeler_reports_ad_stats').upsert(list.slice(i, i + CHUNK), { onConflict: 'client_id,platform,campaign_id,date_from,date_to' });
    if (error) throw new Error(error.message);
  }
  return { rows: list.length, from: f, to: t };
}

export async function logRun<T>(sb: SupabaseClient, clientId: string | null, kind: string, work: () => Promise<{ rows: number; message?: string } & T>) {
  const { data: run } = await sb.from('wheeler_reports_sync_runs').insert({ client_id: clientId, kind }).select('id').single();
  try {
    const res = await work();
    await sb.from('wheeler_reports_sync_runs').update({ status: 'ok', finished_at: new Date().toISOString(), rows: res.rows, message: res.message ?? null }).eq('id', run?.id);
    return res;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await sb.from('wheeler_reports_sync_runs').update({ status: 'error', finished_at: new Date().toISOString(), message: message.slice(0, 2000) }).eq('id', run?.id);
    throw e;
  }
}

export async function syncClient(sb: SupabaseClient, client: Client, platforms: Platform[], range?: { from: string; to: string }) {
  const to = range?.to ?? todayInZone(client.timezone);
  const from = range?.from ?? addDays(to, -env.syncLookbackDays());
  const stores = await loadStores(sb, client.id);
  const results: { platform: Platform; ok: boolean; message: string }[] = [];

  for (const platform of platforms) {
    try {
      if (platform === 'google') {
        if (!client.google_ads_customer_id) { results.push({ platform, ok: false, message: 'No Google Ads customer ID set for this client.' }); continue; }
        if (!env.google.configured()) { results.push({ platform, ok: false, message: 'Google Ads API keys are not set on the server (.env).' }); continue; }
        const r = await logRun(sb, client.id, 'google', () =>
          replaceAdStats(sb, client.id, 'google', from, to, (f, t) => fetchGoogleAdsDaily(client.google_ads_customer_id!, f, t, stores))
            .then((x) => ({ ...x, message: `${x.from} to ${x.to}` })));
        results.push({ platform, ok: true, message: `${r.rows} campaign-days, ${r.from} to ${r.to}` });
      } else {
        if (!client.meta_ad_account_id) { results.push({ platform, ok: false, message: 'No Meta ad account ID set for this client.' }); continue; }
        if (!env.meta.configured()) { results.push({ platform, ok: false, message: 'Meta API token is not set on the server (.env).' }); continue; }
        const r = await logRun(sb, client.id, 'meta', () =>
          replaceAdStats(sb, client.id, 'meta', from, to, (f, t) => fetchMetaDaily(client.meta_ad_account_id!, f, t, stores))
            .then((x) => ({ ...x, message: `${x.from} to ${x.to}` })));
        results.push({ platform, ok: true, message: `${r.rows} campaign-days, ${r.from} to ${r.to}` });
      }
    } catch (e) {
      results.push({ platform, ok: false, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return results;
}
