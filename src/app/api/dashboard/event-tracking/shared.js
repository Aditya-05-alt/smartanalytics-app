import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { canAccessReport, normalizeAccess } from '@/lib/access/permissions';
import { loadUserAccessRecord } from '@/lib/access/userAccess';
import { createClient as createAuthClient } from '@/lib/supabase/server';

/** Event Tracking is an explicit grant (smart_user_reports); demo/superadmin sessions don't get it. */
async function authorizeEventTracking() {
  const authClient = await createAuthClient();
  if (!authClient) return { authorized: false, dealerIds: null };

  const {
    data: { user },
    error: userError,
  } = await authClient.auth.getUser();
  if (userError || !user) return { authorized: false, dealerIds: null };

  const accessRecord = await loadUserAccessRecord(authClient, user.id);
  const access = normalizeAccess(accessRecord);
  if (!canAccessReport(access, 'event-tracking')) {
    return { authorized: false, dealerIds: null };
  }

  return {
    authorized: true,
    dealerIds: access.role === 'admin' || access.allDealers
      ? null
      : new Set(access.dealerIds),
  };
}

/** Event Tracking data (form events, daily VDP summary) starts here. */
export const EVENT_TRACKING_MIN_DATE = '2026-10-01';

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function parseRange(searchParams) {
  const from = searchParams.get('from') || '';
  const to = searchParams.get('to') || '';
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) return null;
  if (from < EVENT_TRACKING_MIN_DATE) return null;
  return { from, to };
}

/**
 * Shared prologue for Event Tracking routes: auth, date-range validation and the dealers this
 * user may see. Returns `{ response }` to send as-is, or `{ supabase, from, to, dealers }`.
 */
export async function prepareEventTrackingRequest(request) {
  let authorization;
  try {
    authorization = await authorizeEventTracking();
  } catch (error) {
    console.error('[event-tracking] authorization failed:', error?.message);
    return { response: NextResponse.json({ error: 'Could not verify access' }, { status: 500 }) };
  }
  if (!authorization.authorized) {
    return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const range = parseRange(new URL(request.url).searchParams);
  if (!range) {
    return {
      response: NextResponse.json(
        { error: `from/to must be YYYY-MM-DD dates on or after ${EVENT_TRACKING_MIN_DATE}` },
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
    console.error('[event-tracking] dealer lookup failed:', error.message);
    return { response: NextResponse.json({ error: error.message }, { status: 500 }) };
  }

  const byClientId = new Map();
  for (const row of configs || []) {
    const clientId = String(row.ga4_customer_id || '').trim();
    if (!clientId || !row.customer_name || byClientId.has(clientId)) continue;
    if (authorization.dealerIds && !authorization.dealerIds.has(Number(row.id))) continue;
    byClientId.set(clientId, { dealerId: Number(row.id), name: row.customer_name.trim(), clientId });
  }
  const dealers = [...byClientId.values()].sort((a, b) => a.name.localeCompare(b.name));
  if (!dealers.length) {
    return {
      response: NextResponse.json(
        { error: 'No dealers are assigned to this account' },
        { status: 403 }
      ),
    };
  }

  return { supabase, from: range.from, to: range.to, dealers };
}
