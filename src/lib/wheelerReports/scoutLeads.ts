// Scout RV Content API → Media Cost lead rows (A&L / al-rv-sales).
// Stats-key responses hash PII; contact names stay empty. Email/phone never stored.
import 'server-only';
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { addDays, dateInZone, todayInZone } from './dates';
import { loadStores } from './data';
import { env } from './env';
import type { LeadImportResult } from './leadImport';
import { logRun } from './sync';
import type { Client, Store } from './types';

export const SCOUT_AL_SLUG = 'al-rv-sales';
export const SCOUT_AL_TENANT = 'al-rv-sales';

type ScoutClickIds = {
  gclid?: string | null;
  gbraid?: string | null;
  gad_campaignid?: string | null;
  msclkid?: string | null;
  fbclid?: string | null;
};

type ScoutLead = {
  id: string;
  created_at: string;
  category?: string | null;
  lead_type?: string | null;
  form_name?: string | null;
  customer?: {
    email_sha256?: string | null;
    phone_sha256?: string | null;
  } | null;
  store?: {
    name?: string | null;
    city?: string | null;
    slug?: string | null;
  } | null;
  attribution?: {
    source?: string | null;
    lead_source?: string | null;
    lead_source_detail?: string | null;
    utm_source?: string | null;
    utm_medium?: string | null;
    utm_campaign?: string | null;
    click_ids?: ScoutClickIds | null;
  } | null;
  session?: {
    utm_source?: string | null;
    utm_medium?: string | null;
    utm_campaign?: string | null;
  } | null;
};

type ScoutListPayload = {
  success?: boolean;
  data?: {
    total?: number;
    returned?: number;
    has_more?: boolean;
    next_offset?: number | null;
    leads?: ScoutLead[];
  };
};

const DEFAULT_BASE = 'https://www.scout-rv.com/api/content-api/v1/leads';

function locationKeys(store: ScoutLead['store']): string[] {
  if (!store) return [];
  return [store.name, store.city]
    .map((x) => (x || '').trim().toLowerCase())
    .filter(Boolean);
}

/** Map one Scout lead into the same shape as CSV import. */
export function mapScoutLead(
  lead: ScoutLead,
  stores: Pick<Store, 'id' | 'lead_locations'>[],
  timeZone: string,
  opts: { from?: string; to?: string } = {},
): { lead: LeadImportResult['leads'][number] | null; unknownLocation: string | null; skippedOutside: boolean; bad: boolean } {
  const byLocation = new Map<string, string>();
  for (const s of stores) for (const loc of s.lead_locations) byLocation.set(loc.trim().toLowerCase(), s.id);

  const id = (lead.id || '').trim();
  const t = lead.created_at ? new Date(lead.created_at) : null;
  if (!id || !t || Number.isNaN(t.getTime())) return { lead: null, unknownLocation: null, skippedOutside: false, bad: true };

  const date = dateInZone(t, timeZone);
  if ((opts.from && date < opts.from) || (opts.to && date > opts.to)) {
    return { lead: null, unknownLocation: null, skippedOutside: true, bad: false };
  }

  const keys = locationKeys(lead.store);
  let storeId: string | null = null;
  for (const k of keys) {
    storeId = byLocation.get(k) ?? null;
    if (storeId) break;
  }
  const unknownLocation = storeId ? null : keys[0] || lead.store?.name || '(blank)';

  const attr = lead.attribution || {};
  const sess = lead.session || {};
  let source = (attr.utm_source || attr.lead_source || attr.source || sess.utm_source || '').trim();
  let medium = (attr.utm_medium || sess.utm_medium || '').trim();
  if (!source || source.toLowerCase() === 'direct') {
    source = '(direct)';
    medium = '(none)';
  }
  if (/^facebook/i.test(source) || source.toLowerCase() === 'ig') source = source.toLowerCase() === 'ig' ? 'ig' : 'facebook';
  medium = medium || '(none)';

  let campaign = (attr.utm_campaign || sess.utm_campaign || '').trim();
  const detail = String(attr.lead_source_detail || '').split('/');
  const s = source.toLowerCase();
  const m = medium.toLowerCase();
  if (s === 'google' && m === 'cpc' && /^\d+$/.test(detail[2] || '')) campaign = detail[2];
  if (s === 'google' && m === 'organic' && (detail[2] || '').startsWith('google_my_business')) campaign = detail[2];
  if (!campaign && attr.click_ids?.gad_campaignid) campaign = String(attr.click_ids.gad_campaignid);

  const who =
    (lead.customer?.email_sha256 || lead.customer?.phone_sha256 || id).toLowerCase();

  return {
    lead: {
      external_id: id,
      store_id: storeId,
      lead_date: date,
      created_at_utc: t.toISOString(),
      source,
      medium,
      campaign,
      lead_type: (lead.lead_type || '').trim(),
      form: (lead.form_name || '').trim(),
      contact_name: '',
      person_hash: createHash('sha256').update(who).digest('hex').slice(0, 16),
    },
    unknownLocation,
    skippedOutside: false,
    bad: false,
  };
}

export function mapScoutLeads(
  leads: ScoutLead[],
  stores: Pick<Store, 'id' | 'lead_locations'>[],
  timeZone: string,
  opts: { from?: string; to?: string } = {},
): LeadImportResult {
  const out: LeadImportResult = { leads: [], skippedOutsideDates: 0, unknownLocations: {}, badRows: 0 };
  for (const raw of leads) {
    const mapped = mapScoutLead(raw, stores, timeZone, opts);
    if (mapped.bad) {
      out.badRows++;
      continue;
    }
    if (mapped.skippedOutside) {
      out.skippedOutsideDates++;
      continue;
    }
    if (mapped.unknownLocation) {
      out.unknownLocations[mapped.unknownLocation] =
        (out.unknownLocations[mapped.unknownLocation] || 0) + 1;
    }
    if (mapped.lead) out.leads.push(mapped.lead);
  }
  return out;
}

/** Paginate Scout leads for a tenant + date range. */
export async function fetchScoutLeads(opts: {
  apiKey: string;
  tenant: string;
  from: string;
  to: string;
  baseUrl?: string;
  pageSize?: number;
}): Promise<{ leads: ScoutLead[]; total: number }> {
  const base = (opts.baseUrl || DEFAULT_BASE).replace(/\?.*$/, '').replace(/\/$/, '');
  const limit = opts.pageSize ?? 250;
  const all: ScoutLead[] = [];
  let offset = 0;
  let total = 0;

  for (let page = 0; page < 40; page++) {
    const url = new URL(base);
    url.searchParams.set('tenant', opts.tenant);
    url.searchParams.set('from', opts.from);
    url.searchParams.set('to', opts.to);
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('limit', String(limit));

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Scout leads API ${res.status}: ${body.slice(0, 240)}`);
    }
    const json = (await res.json()) as ScoutListPayload;
    if (json.success === false) throw new Error('Scout leads API returned success=false');
    const data = json.data || {};
    total = Number(data.total ?? total);
    const batch = data.leads || [];
    all.push(...batch);
    if (!data.has_more || !batch.length) break;
    offset = data.next_offset != null ? Number(data.next_offset) : offset + batch.length;
  }

  return { leads: all, total };
}

/** Days re-pulled on each scheduled Scout sync (late leads + timezone edge). */
export const scoutLeadsLookbackDays = () => {
  const n = Number(process.env.SCOUT_LEADS_LOOKBACK_DAYS || '14');
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 90) : 14;
};

/**
 * Upsert Scout website leads for one Media Cost client (A&L only).
 * Removes GA4 synthetic leads in the same date window to avoid double counts.
 */
export async function syncScoutLeadsForClient(
  sb: SupabaseClient,
  client: Pick<Client, 'id' | 'slug' | 'timezone'>,
  range?: { from: string; to: string },
): Promise<{ ok: boolean; rows: number; message: string }> {
  if (client.slug !== SCOUT_AL_SLUG) {
    return { ok: false, rows: 0, message: 'Scout API sync is only enabled for A&L RV Sales.' };
  }
  if (!env.scout.configured()) {
    return { ok: false, rows: 0, message: 'SCOUT_RV_API_KEY is missing on the server.' };
  }

  const to = range?.to ?? todayInZone(client.timezone);
  const from = range?.from ?? addDays(to, -(scoutLeadsLookbackDays() - 1));

  try {
    const stores = await loadStores(sb, client.id);
    const res = await logRun(sb, client.id, 'scout_leads', async () => {
      const { leads: raw, total } = await fetchScoutLeads({
        apiKey: env.scout.apiKey(),
        tenant: SCOUT_AL_TENANT,
        from,
        to,
        baseUrl: env.scout.leadsUrl(),
      });
      const imp = mapScoutLeads(raw, stores, client.timezone, { from, to });
      for (let i = 0; i < imp.leads.length; i += 500) {
        const chunk = imp.leads.slice(i, i + 500).map((l) => ({
          ...l,
          client_id: client.id,
          imported_at: new Date().toISOString(),
        }));
        const { error } = await sb.from('wheeler_reports_leads').upsert(chunk, { onConflict: 'client_id,external_id' });
        if (error) throw new Error(error.message);
      }

      const { data: removed, error: delErr } = await sb
        .from('wheeler_reports_leads')
        .delete()
        .eq('client_id', client.id)
        .gte('lead_date', from)
        .lte('lead_date', to)
        .like('external_id', 'ga4|%')
        .select('id');
      if (delErr) throw new Error(delErr.message);

      const unknown = Object.entries(imp.unknownLocations).map(([k, n]) => `${k} (${n})`).join(', ');
      return {
        rows: imp.leads.length,
        message:
          `Scout API: ${imp.leads.length} leads saved for ${from} to ${to}` +
          (total ? ` (API total ${total})` : '') +
          `. Removed ${removed?.length ?? 0} GA4 synthetic leads.` +
          (imp.skippedOutsideDates ? ` ${imp.skippedOutsideDates} outside the dates were skipped.` : '') +
          (unknown ? ` No store matched: ${unknown}.` : '') +
          (imp.badRows ? ` ${imp.badRows} rows had no id or date.` : '') +
          ' Contact names are blank on the stats API key (hashes only).',
      };
    });
    return { ok: true, rows: res.rows, message: res.message ?? 'Saved.' };
  } catch (e) {
    return { ok: false, rows: 0, message: e instanceof Error ? e.message : String(e) };
  }
}
