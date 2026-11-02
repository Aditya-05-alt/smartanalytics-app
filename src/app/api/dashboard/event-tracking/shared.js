import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { canAccessReport, normalizeAccess } from '@/lib/access/permissions';
import { loadUserAccessRecord } from '@/lib/access/userAccess';
import { isValidSuperadminSession, SUPERADMIN_COOKIE } from '@/lib/auth/superadmin';
import { createClient as createAuthClient } from '@/lib/supabase/server';

const DEALER_NAMES = ['Sky River RV', "Gerzeny's RV", 'A&L RV Sales'];

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

async function authorizeEventTracking() {
  const cookieStore = await cookies();
  if (
    isValidSuperadminSession(cookieStore.get(SUPERADMIN_COOKIE)?.value) ||
    cookieStore.get('sa_demo_session')
  ) {
    return { authorized: true, dealerIds: null };
  }

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

function parsePeriods(searchParams) {
  const periods = {
    currentFrom: searchParams.get('currentFrom'),
    currentTo: searchParams.get('currentTo'),
    previousFrom: searchParams.get('previousFrom'),
    previousTo: searchParams.get('previousTo'),
    averageFrom: searchParams.get('averageFrom'),
    averageTo: searchParams.get('averageTo'),
  };

  if (Object.values(periods).some((date) => !isIsoDate(date))) {
    return { error: NextResponse.json({ error: 'Invalid or missing date ranges' }, { status: 400 }) };
  }
  const monthStart = new Date(`${periods.currentFrom}T00:00:00.000Z`);
  const monthEnd = new Date(Date.UTC(
    monthStart.getUTCFullYear(),
    monthStart.getUTCMonth() + 1,
    0
  )).toISOString().slice(0, 10);
  if (
    monthStart.getUTCDate() !== 1 ||
    periods.currentTo !== monthEnd ||
    periods.currentFrom > periods.currentTo ||
    periods.previousFrom !== periods.currentFrom ||
    periods.previousTo !== periods.currentTo ||
    periods.averageFrom !== periods.currentFrom ||
    periods.averageTo !== periods.currentTo
  ) {
    return {
      error: NextResponse.json(
        { error: 'Only one complete calendar month can be requested' },
        { status: 400 }
      ),
    };
  }
  const requestedDays =
    (Date.parse(`${periods.currentTo}T00:00:00Z`) -
      Date.parse(`${periods.averageFrom}T00:00:00Z`)) /
      86_400_000 +
    1;
  if (requestedDays > 130) {
    return { error: NextResponse.json({ error: 'Date range exceeds the 130-day limit' }, { status: 400 }) };
  }
  return { periods };
}

/**
 * Shared prologue for the Event Tracking routes: auth, date validation and dealer lookup.
 * Returns `{ response }` to send as-is, or `{ supabase, periods, dealersByName, availableDealerNames }`.
 */
export async function prepareEventTrackingRequest(request) {
  let authorization;
  try {
    authorization = await authorizeEventTracking();
  } catch (error) {
    const message = error?.message || 'Failed to verify Event Tracking access';
    console.error('[event-tracking] authorization failed:', message);
    return { response: NextResponse.json({ error: 'Could not verify access' }, { status: 500 }) };
  }
  if (!authorization.authorized) {
    return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const { periods, error: periodsError } = parsePeriods(new URL(request.url).searchParams);
  if (periodsError) return { response: periodsError };

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

  try {
    const { data: configs, error: configError } = await supabase
      .from('smart_hoot_config')
      .select('id, customer_name, ga4_customer_id')
      .eq('is_active', true)
      .in('customer_name', DEALER_NAMES);
    if (configError) throw configError;

    const dealersByName = new Map(
      (configs || [])
        .filter((row) =>
          row.customer_name &&
          row.ga4_customer_id &&
          (!authorization.dealerIds || authorization.dealerIds.has(Number(row.id)))
        )
        .map((row) => [
          row.customer_name,
          {
            dealerId: Number(row.id),
            name: row.customer_name,
            clientId: String(row.ga4_customer_id),
          },
        ])
    );
    const availableDealerNames = DEALER_NAMES.filter((name) => dealersByName.has(name));
    if (!availableDealerNames.length) {
      return {
        response: NextResponse.json(
          { error: 'No Event Tracking dealers are assigned to this account' },
          { status: 403 }
        ),
      };
    }
    const expectedDealerNames = authorization.dealerIds
      ? availableDealerNames
      : DEALER_NAMES;
    const missingDealers = expectedDealerNames.filter((name) => !dealersByName.has(name));
    if (missingDealers.length) {
      throw new Error(`Missing active GA4 configuration for: ${missingDealers.join(', ')}`);
    }

    return { supabase, periods, dealersByName, availableDealerNames };
  } catch (error) {
    const message = error?.message || 'Failed to load Event Tracking metrics';
    console.error('[event-tracking]', message);
    return { response: NextResponse.json({ error: message }, { status: 500 }) };
  }
}

const KNOWN_CHANNELS = {
  organic_search: 'Organic Search',
  organicsearch: 'Organic Search',
  paid_search: 'Paid Search',
  paidsearch: 'Paid Search',
  direct: 'Direct',
  paid_social: 'Paid Social',
  paidsocial: 'Paid Social',
  organic_social: 'Organic Social',
  organicsocial: 'Organic Social',
  cross_network: 'Cross-network',
  referral: 'Referral',
  email: 'Email',
  ai_assistant: 'AI Assistant',
  unassigned: 'Unassigned',
  '(not_set)': 'Unassigned',
  display: 'Display',
  paid_video: 'Paid Video',
  organic_video: 'Organic Video',
  affiliates: 'Affiliates',
  paid_other: 'Paid Other',
  sms: 'SMS',
  audio: 'Audio',
};

export function formatChannelName(value) {
  const raw = String(value || '').trim();
  const normalized = raw.toLowerCase().replace(/[\s-]+/g, '_');
  if (KNOWN_CHANNELS[normalized]) return KNOWN_CHANNELS[normalized];
  if (!raw) return 'Unassigned';
  return raw
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const ALL_CHANNELS = '(all)';

/**
 * GA4 totalUsers for the whole period (smart_events_users, written by smart-ga4-total-users).
 * Returns null when the period has not been synced for this dealer.
 */
export async function loadStoredUsers(supabase, clientId, periods) {
  const { data, error } = await supabase
    .from('smart_events_users')
    .select('channel, total_users')
    .eq('client_id', clientId)
    .eq('period_from', periods.currentFrom)
    .eq('period_to', periods.currentTo);
  if (error) throw error;
  if (!data?.length) return null;

  let total = 0;
  const byChannel = new Map();
  for (const row of data) {
    const users = Number(row.total_users) || 0;
    if (row.channel === ALL_CHANNELS) {
      total = users;
      continue;
    }
    const name = formatChannelName(row.channel);
    byChannel.set(name, (byChannel.get(name) || 0) + users);
  }
  return { total, byChannel };
}

export function isMissingRpcError(error, rpcName) {
  return (
    error?.code === '42883' ||
    new RegExp(`${rpcName}|schema cache|could not find the function`, 'i').test(
      error?.message || ''
    )
  );
}
