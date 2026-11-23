import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { canAccessReport, normalizeAccess } from '@/lib/access/permissions';
import { loadUserAccessRecord } from '@/lib/access/userAccess';
import { createClient as createAuthClient } from '@/lib/supabase/server';

/** Final VDP views by channel (smart_event_tracking_vdp_daily) start here. */
export const VDP_CHANGE_MIN_MONTH = '2026-01';
/** GA4's last two days aren't final, so data always runs through two days ago. */
const SETTLE_DAYS = 2;
/** Dealers per smart-ga4-total-users call (edge processes them sequentially). */
export const TRAFFIC_SYNC_CHUNK = 8;
/** Max parallel edge invokes (cur+prev share the pool). */
export const TRAFFIC_SYNC_CONCURRENCY = 6;
/**
 * Settling (open) periods older than this can be refreshed. Interactive date-range
 * loads skip this and only sync dealers with no traffic row at all — daily cron
 * keeps MTD fresh; re-pulling ~90 dealers on every picker change was 30–90s+.
 */
const RECENT_TRAFFIC_MAX_AGE_MS = 12 * 60 * 60 * 1000;

const iso = (date) => date.toISOString().slice(0, 10);
const utc = (y, m, d) => new Date(Date.UTC(y, m, d));
const daysIn = (y, m) => utc(y, m + 1, 0).getUTCDate();
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Shift a calendar ISO date by whole months, clamping the day (Jan 31 → Feb 28). */
function shiftMonthsISO(dayIso, deltaMonths) {
  const m = ISO_DAY.exec(dayIso || '');
  if (!m) return dayIso;
  let y = +m[1];
  let mo = +m[2] - 1 + deltaMonths;
  const d = +m[3];
  y += Math.floor(mo / 12);
  mo = ((mo % 12) + 12) % 12;
  return iso(utc(y, mo, Math.min(d, daysIn(y, mo))));
}

/** Shift a calendar ISO date by whole years, clamping Feb 29 → Feb 28. */
function shiftYearsISO(dayIso, deltaYears) {
  const m = ISO_DAY.exec(dayIso || '');
  if (!m) return dayIso;
  const y = +m[1] + deltaYears;
  const mo = +m[2] - 1;
  const d = +m[3];
  return iso(utc(y, mo, Math.min(d, daysIn(y, mo))));
}

/**
 * This period and the one it is compared with.
 * Prefer explicit from/to (Overview date picker). Otherwise month: 'YYYY-MM'
 * (default: the current month, or last month in its first two days).
 * compare: 'pm' (previous month) or 'ly' (same dates last year).
 */
export function vdpChangePeriods(monthParam, compare, fromParam, toParam) {
  const now = new Date();
  const lastDay = utc(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - SETTLE_DAYS);
  const throughDate = iso(lastDay);
  const mode = compare === 'ly' ? 'ly' : 'pm';

  let from;
  let to;
  if (ISO_DAY.test(fromParam || '') && ISO_DAY.test(toParam || '')) {
    from = fromParam <= toParam ? fromParam : toParam;
    to = fromParam <= toParam ? toParam : fromParam;
    if (to > throughDate) to = throughDate;
    if (from > to) from = to;
  } else {
    const m = /^(\d{4})-(\d{2})$/.exec(monthParam || '');
    let y = m ? +m[1] : lastDay.getUTCFullYear();
    let mo = m ? +m[2] - 1 : lastDay.getUTCMonth();
    if (utc(y, mo, 1) > lastDay) {
      y = lastDay.getUTCFullYear();
      mo = lastDay.getUTCMonth();
    }
    const monthEnd = utc(y, mo, daysIn(y, mo));
    const end = monthEnd < lastDay ? monthEnd : lastDay;
    from = iso(utc(y, mo, 1));
    to = iso(utc(y, mo, end.getUTCDate()));
  }

  const prevFrom = mode === 'ly' ? shiftYearsISO(from, -1) : shiftMonthsISO(from, -1);
  const prevTo = mode === 'ly' ? shiftYearsISO(to, -1) : shiftMonthsISO(to, -1);
  const month = to.slice(0, 7);
  const endDay = +to.slice(8);
  const [y, mo] = month.split('-').map(Number);

  return {
    month,
    compare: mode,
    from,
    to,
    prevFrom,
    prevTo,
    throughDate,
    complete: endDay === daysIn(y, mo - 1) && from === iso(utc(y, mo - 1, 1)),
  };
}

/** Explicit grant (smart_user_reports 'vdp-change'); returns the dealer ids a user may see. */
async function authorizeVdpChange() {
  const authClient = await createAuthClient();
  if (!authClient) return { authorized: false };
  const {
    data: { user },
    error,
  } = await authClient.auth.getUser();
  if (error || !user) return { authorized: false };
  const access = normalizeAccess(await loadUserAccessRecord(authClient, user.id));
  if (!canAccessReport(access, 'vdp-change')) return { authorized: false };
  return {
    authorized: true,
    dealerIds: access.role === 'admin' || access.allDealers ? null : new Set(access.dealerIds),
  };
}

/**
 * Shared prologue for VDP Change routes: auth, the two periods and the dealers this user may see.
 * Returns `{ response }` to send as-is, or `{ supabase, periods, dealers }`.
 */
export async function prepareVdpChangeRequest(request) {
  let auth;
  try {
    auth = await authorizeVdpChange();
  } catch (error) {
    console.error('[vdp-change] authorization failed:', error?.message);
    return { response: NextResponse.json({ error: 'Could not verify access' }, { status: 500 }) };
  }
  if (!auth.authorized) {
    return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const params = new URL(request.url).searchParams;
  const periods = vdpChangePeriods(
    params.get('month'),
    params.get('compare'),
    params.get('from'),
    params.get('to'),
  );
  if (periods.month < VDP_CHANGE_MIN_MONTH || periods.from < `${VDP_CHANGE_MIN_MONTH}-01`) {
    return {
      response: NextResponse.json(
        { error: `VDP Change data starts in ${VDP_CHANGE_MIN_MONTH}` },
        { status: 400 }
      ),
    };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return {
      response: NextResponse.json(
        { error: 'SUPABASE_SERVICE_ROLE_KEY is not configured on the server' },
        { status: 503 }
      ),
    };
  }
  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: configs, error } = await supabase
    .from('smart_hoot_config')
    .select('id, customer_name, ga4_customer_id')
    .eq('is_active', true);
  if (error) {
    console.error('[vdp-change] dealer lookup failed:', error.message);
    return { response: NextResponse.json({ error: error.message }, { status: 500 }) };
  }
  const byClientId = new Map();
  for (const row of configs || []) {
    const clientId = String(row.ga4_customer_id || '').trim();
    if (!clientId || !row.customer_name || byClientId.has(clientId)) continue;
    if (auth.dealerIds && !auth.dealerIds.has(Number(row.id))) continue;
    byClientId.set(clientId, { clientId, name: row.customer_name.trim() });
  }
  const dealers = [...byClientId.values()].sort((a, b) => a.name.localeCompare(b.name));
  if (!dealers.length) {
    return { response: NextResponse.json({ error: 'No dealers are assigned to this account' }, { status: 403 }) };
  }
  return { supabase, periods, dealers };
}

/**
 * Dealers missing GA4 users / sessions / page views for either period.
 * @param {{ refreshStale?: boolean }} [opts] — when true, also re-fetch settling
 *   periods older than RECENT_TRAFFIC_MAX_AGE_MS (cron / forced refresh). Default false
 *   so date-range changes stay in the 2–5s path when rows already exist.
 */
export async function findClientsNeedingTraffic(supabase, periods, clientIds, opts = {}) {
  const refreshStale = opts.refreshStale === true;
  const settling = refreshStale && periods.to >= periods.throughDate;
  const ranges = [[periods.from, periods.to, settling], [periods.prevFrom, periods.prevTo, false]];
  const missing = new Set();
  for (const [from, to, recent] of ranges) {
    const { data, error } = await supabase
      .from('smart_events_users')
      .select('client_id, sessions, created_at')
      .eq('period_from', from)
      .eq('period_to', to)
      .eq('channel', '(all)')
      .in('client_id', clientIds);
    if (error) throw error;
    const fresh = new Set(
      (data || [])
        .filter((row) => row.sessions != null)
        .filter((row) => !recent || Date.now() - Date.parse(row.created_at) < RECENT_TRAFFIC_MAX_AGE_MS)
        .map((row) => String(row.client_id))
    );
    for (const id of clientIds) if (!fresh.has(id)) missing.add(id);
  }
  return [...missing];
}

/** Run `worker` over `items` with at most `limit` in flight. */
async function mapPool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) || 1 }, async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

/** Fetch GA4 users / sessions / page views for both periods (smart-ga4-total-users stores them). */
export async function syncTraffic(supabase, periods, clientIds) {
  const ids = (clientIds || []).map(String).filter(Boolean);
  if (!ids.length) return [];
  const ranges = [
    [periods.from, periods.to],
    [periods.prevFrom, periods.prevTo],
  ];
  const jobs = [];
  for (let i = 0; i < ids.length; i += TRAFFIC_SYNC_CHUNK) {
    const chunk = ids.slice(i, i + TRAFFIC_SYNC_CHUNK);
    for (const [from, to] of ranges) {
      jobs.push({ chunk, from, to });
    }
  }
  const errors = [];
  await mapPool(jobs, TRAFFIC_SYNC_CONCURRENCY, async ({ chunk, from, to }) => {
    try {
      const { error } = await supabase.functions.invoke('smart-ga4-total-users', {
        body: { client_ids: chunk, date_from: from, date_to: to },
      });
      if (error) errors.push(error.message || String(error));
    } catch (err) {
      errors.push(err?.message || String(err));
    }
  });
  if (errors.length) console.error('[vdp-change] traffic sync failed:', errors.join('; '));
  return errors;
}

/** Sync every dealer still missing traffic for these periods (one server round-trip). */
export async function syncMissingTraffic(supabase, periods, clientIds) {
  const missing = await findClientsNeedingTraffic(supabase, periods, clientIds, { refreshStale: false });
  if (!missing.length) return { missing: 0, errors: [] };
  const errors = await syncTraffic(supabase, periods, missing);
  return { missing: missing.length, errors };
}
