import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { isValidSuperadminSession, SUPERADMIN_COOKIE } from '@/lib/auth/superadmin';
import { enumerateDatesInclusive } from '@/lib/ga4/dateRange';
import { createServiceRoleClient } from '@/lib/supabase/serviceRole';

const MAX_DAYS = 31;
const DAY_CONCURRENCY = 4;

async function isAuthorized() {
  const jar = await cookies();
  if (isValidSuperadminSession(jar.get(SUPERADMIN_COOKIE)?.value)) return true;
  if (jar.get('sa_demo_session')) return true;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return false;

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return jar.getAll();
      },
      setAll() {},
    },
  });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return Boolean(user);
}

function normalizeRow(r) {
  return {
    report_date: String(r.report_date).split('T')[0],
    client_id: String(r.client_id ?? ''),
    account_name: r.account_name ?? null,
    customer_name: r.customer_name ?? null,
    views: Number(r.views || 0),
  };
}

async function rpcOneDay(supabase, day, clientId) {
  const { data, error } = await supabase.rpc('build_date_wise_ga4_data', {
    p_date_from: day,
    p_date_to: day,
    p_client_id: clientId,
  });
  if (error) throw error;
  return (data || []).map(normalizeRow);
}

export async function GET(request) {
  if (!(await isAuthorized())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const from = searchParams.get('from')?.slice(0, 10);
  const to = searchParams.get('to')?.slice(0, 10);
  const clientId = searchParams.get('clientId')?.trim() || null;

  if (!from || !to) {
    return NextResponse.json({ error: 'Missing from or to' }, { status: 400 });
  }

  const days = enumerateDatesInclusive(from, to);
  if (days.length > MAX_DAYS) {
    return NextResponse.json(
      { error: `Date range is ${days.length} days. Maximum is ${MAX_DAYS}.` },
      { status: 400 }
    );
  }

  const supabase = createServiceRoleClient();
  if (!supabase) {
    return NextResponse.json(
      {
        error:
          'SUPABASE_SERVICE_ROLE_KEY is not set. Using browser fallback may be slower.',
      },
      { status: 503 }
    );
  }

  try {
    const merged = [];

    for (let i = 0; i < days.length; i += DAY_CONCURRENCY) {
      const batch = days.slice(i, i + DAY_CONCURRENCY);
      const parts = await Promise.all(
        batch.map((day) => rpcOneDay(supabase, day, clientId))
      );
      for (const part of parts) merged.push(...part);
    }

    return NextResponse.json({
      rows: merged,
      meta: { days: days.length, rowCount: merged.length, source: 'chunked-rpc' },
    });
  } catch (err) {
    const message = err?.message || 'Failed to load date-wise views';
    const hint =
      err?.code === '57014' || /timeout/i.test(message)
        ? ' Add index: CREATE INDEX ON smart_ga4_page_data (report_date, client_id);'
        : '';
    return NextResponse.json({ error: message + hint }, { status: 500 });
  }
}
