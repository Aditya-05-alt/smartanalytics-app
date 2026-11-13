import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { canAccessReport, normalizeAccess } from '@/lib/access/permissions';
import { loadUserAccessRecord } from '@/lib/access/userAccess';
import { createClient as createAuthClient } from '@/lib/supabase/server';

/** Final VDP views by channel (smart_event_tracking_vdp_daily) start here. */
export const VDP_CHANGE_MIN_MONTH = '2026-01';
/** GA4's last two days aren't final, so data always runs through two days ago. */
const SETTLE_DAYS = 2;
/** Dealers per smart-ga4-total-users call (the page shows progress per chunk). */
export const TRAFFIC_SYNC_CHUNK = 10;
/** Periods ending this close to today are re-fetched once their traffic is this old. */
const RECENT_TRAFFIC_MAX_AGE_MS = 12 * 60 * 60 * 1000;

const iso = (date) => date.toISOString().slice(0, 10);
const utc = (y, m, d) => new Date(Date.UTC(y, m, d));
const daysIn = (y, m) => utc(y, m + 1, 0).getUTCDate();

/**
 * This period and the one it is compared with, covering the same days of the month.
 * month: 'YYYY-MM' (default: the current month, or last month in its first two days).
 * compare: 'pm' (previous month) or 'ly' (same month last year).
 */
export function vdpChangePeriods(monthParam, compare) {
  const now = new Date();
  const lastDay = utc(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - SETTLE_DAYS);
  const m = /^(\d{4})-(\d{2})$/.exec(monthParam || '');
  let y = m ? +m[1] : lastDay.getUTCFullYear();
  let mo = m ? +m[2] - 1 : lastDay.getUTCMonth();
  if (utc(y, mo, 1) > lastDay) {
    y = lastDay.getUTCFullYear();
    mo = lastDay.getUTCMonth();
  }
  const monthEnd = utc(y, mo, daysIn(y, mo));
  const end = monthEnd < lastDay ? monthEnd : lastDay;
  const endDay = end.getUTCDate();
  const [py, pm] = compare === 'ly' ? [y - 1, mo] : mo === 0 ? [y - 1, 11] : [y, mo - 1];
  const prevEndDay = Math.min(endDay, daysIn(py, pm));
  return {
    month: `${y}-${String(mo + 1).padStart(2, '0')}`,
    compare: compare === 'ly' ? 'ly' : 'pm',
    from: iso(utc(y, mo, 1)),
    to: iso(utc(y, mo, endDay)),
    prevFrom: iso(utc(py, pm, 1)),
    prevTo: iso(utc(py, pm, prevEndDay)),
    throughDate: iso(lastDay),
    complete: endDay === daysIn(y, mo),
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
  const periods = vdpChangePeriods(params.get('month'), params.get('compare'));
  if (periods.month < VDP_CHANGE_MIN_MONTH) {
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

/** Dealers missing GA4 users / sessions / page views for either period (or with stale recent ones). */
export async function findClientsNeedingTraffic(supabase, periods, clientIds) {
  const settling = periods.to >= periods.throughDate;
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

/** Fetch GA4 users / sessions / page views for both periods (smart-ga4-total-users stores them). */
export async function syncTraffic(supabase, periods, clientIds) {
  const calls = [
    [periods.from, periods.to],
    [periods.prevFrom, periods.prevTo],
  ].map(([from, to]) =>
    supabase.functions.invoke('smart-ga4-total-users', {
      body: { client_ids: clientIds, date_from: from, date_to: to },
    })
  );
  const results = await Promise.allSettled(calls);
  const errors = [];
  for (const result of results) {
    const failure = result.status === 'rejected' ? result.reason : result.value?.error;
    if (failure) errors.push(failure?.message || String(failure));
  }
  if (errors.length) console.error('[vdp-change] traffic sync failed:', errors.join('; '));
  return errors;
}
