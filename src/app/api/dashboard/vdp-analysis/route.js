import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { canAccessReport, normalizeAccess } from '@/lib/access/permissions';
import { loadUserAccessRecord } from '@/lib/access/userAccess';
import { isValidSuperadminSession, SUPERADMIN_COOKIE } from '@/lib/auth/superadmin';
import { createClient as createAuthClient } from '@/lib/supabase/server';

export const maxDuration = 60;

const isIsoDate = (value) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value || '') &&
  new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;

/**
 * Returns { denied } with the error response, or { clientIds } with the GA4 client ids the user may see
 * (null = every dealer).
 */
async function authorize(supabase) {
  const cookieStore = await cookies();
  if (
    isValidSuperadminSession(cookieStore.get(SUPERADMIN_COOKIE)?.value) ||
    cookieStore.get('sa_demo_session')
  ) {
    return { clientIds: null };
  }

  const authClient = await createAuthClient();
  const {
    data: { user },
  } = authClient ? await authClient.auth.getUser() : { data: { user: null } };
  if (!user) return { denied: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };

  const access = normalizeAccess(await loadUserAccessRecord(authClient, user.id));
  if (!canAccessReport(access, 'vdp-analysis')) {
    return { denied: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  if (access.role === 'admin' || access.allDealers) return { clientIds: null };

  const { data: dealers, error } = await supabase
    .from('smart_hoot_config')
    .select('ga4_customer_id')
    .eq('is_active', true)
    .in('id', access.dealerIds.length ? access.dealerIds : [-1]);
  if (error) throw error;
  return {
    clientIds: [...new Set((dealers || []).map((row) => String(row.ga4_customer_id || '').trim()).filter(Boolean))],
  };
}

/**
 * ?clientId&from&to: one dealer's in-stock units with VDP views by channel (get_vdp_analysis).
 * ?from&to without clientId: per-dealer summary for the All dealers view (get_vdp_analysis_summary).
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const clientId = (searchParams.get('clientId') || '').trim();
  const from = searchParams.get('from') || '';
  const to = searchParams.get('to') || '';
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) {
    return NextResponse.json({ error: 'from and to (YYYY-MM-DD) are required' }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json(
      { error: 'SUPABASE_SERVICE_ROLE_KEY is not configured on the server' },
      { status: 503 }
    );
  }
  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { denied, clientIds } = await authorize(supabase);
    if (denied) return denied;

    if (!clientId) {
      const { data, error } = clientIds
        ? await supabase.rpc('get_vdp_analysis_summary', { p_from: from, p_to: to, p_client_ids: clientIds })
        : await supabase.rpc('get_vdp_analysis_summary_cached', { p_from: from, p_to: to });
      if (error) throw error;
      return NextResponse.json({ from, to, dealers: data?.dealers || [], total: data?.total || null });
    }

    if (clientIds && !clientIds.includes(clientId)) {
      return NextResponse.json({ error: 'No access to this dealer' }, { status: 403 });
    }
    const { data, error } = await supabase.rpc('get_vdp_analysis', {
      p_client_id: clientId,
      p_from: from,
      p_to: to,
    });
    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'Dealer not found' }, { status: 404 });
    return NextResponse.json({ from, to, ...data });
  } catch (error) {
    console.error('[vdp-analysis]', error?.message);
    return NextResponse.json(
      { error: error?.message || 'Failed to load VDP Analysis' },
      { status: 500 }
    );
  }
}
