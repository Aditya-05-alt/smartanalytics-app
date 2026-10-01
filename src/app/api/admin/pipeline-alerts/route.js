import { NextResponse } from 'next/server';
import { getSuperadminFromCookies } from '@/lib/auth/adminApiAuth';
import { createAdminDataClient } from '@/lib/supabase/adminDataClient';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const SNAPSHOT_TABLE = 'smart_pipeline_alert_snapshots';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function toPayload(row) {
  if (!row) return { snapshot: null };
  const payload = row.payload || {};
  return {
    snapshot: {
      id: row.id,
      generatedAt: row.generated_at,
      triggeredBy: row.triggered_by,
      from: row.from_date,
      to: row.to_date,
      pendingDate: payload.pendingDate ?? null,
      settledThrough: payload.settledThrough ?? null,
      settleDays: payload.settleDays ?? null,
      dealers: payload.dealers || null,
      counts: {
        error: row.error_count ?? 0,
        warning: row.warning_count ?? 0,
        pending: row.pending_count ?? 0,
      },
      alerts: payload.alerts || [],
      resolved: payload.resolved || [],
      recheckedDealers: payload.recheckedDealers || {},
      lastDealerRecheckAt: payload.lastDealerRecheckAt ?? null,
      unmappedClients: payload.unmappedClients || [],
      cronFailures: payload.cronFailures || [],
    },
  };
}

function missingTableResponse(message) {
  if (/smart_pipeline_alert_snapshots|refresh_pipeline_alerts|recheck_pipeline_alerts_dealers|schema cache|Could not find/i.test(message)) {
    return NextResponse.json(
      {
        error:
          'Pipeline alerts are not deployed. Apply supabase/rpc/get_pipeline_alerts.sql and supabase/migrations/20261001_pipeline_alerts.sql and 20261001_pipeline_alerts_dealer_recheck.sql.',
      },
      { status: 503 }
    );
  }
  return null;
}

async function requireAdminClient() {
  if (!(await getSuperadminFromCookies())) {
    return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  const admin = createAdminDataClient();
  if (!admin || admin.mode !== 'service') {
    return {
      response: NextResponse.json(
        { error: 'Pipeline alerts need SUPABASE_SERVICE_ROLE_KEY on the server.' },
        { status: 503 }
      ),
    };
  }
  return { supabase: admin.supabase };
}

export async function GET() {
  const { supabase, response } = await requireAdminClient();
  if (response) return response;

  const { data, error } = await supabase
    .from(SNAPSHOT_TABLE)
    .select('*')
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return missingTableResponse(error.message) ||
      NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(toPayload(data));
}

/**
 * Re-check now: recomputes and stores a fresh snapshot (can take ~1 min on cold cache).
 * With `dealerIds`, only those dealers are re-checked (~2s each) and the latest snapshot is patched.
 */
export async function POST(request) {
  const { supabase, response } = await requireAdminClient();
  if (response) return response;

  const body = await request.json().catch(() => ({}));
  const dealerIds = Array.isArray(body?.dealerIds)
    ? [...new Set(body.dealerIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))]
    : [];

  let rpc;
  if (dealerIds.length > 0) {
    rpc = supabase.rpc('recheck_pipeline_alerts_dealers', {
      p_dealer_ids: dealerIds,
      p_triggered_by: body?.source === 'pipeline' ? 'pipeline' : 'admin',
    });
  } else {
    const from = ISO_DATE.test(body?.from || '') ? body.from : null;
    const to = ISO_DATE.test(body?.to || '') ? body.to : null;
    rpc = supabase.rpc('refresh_pipeline_alerts', {
      p_from: from,
      p_to: to,
      p_triggered_by: 'admin',
    });
  }

  const { data, error } = await rpc;

  if (error) {
    return missingTableResponse(error.message) ||
      NextResponse.json({ error: error.message }, { status: 500 });
  }

  const row = Array.isArray(data) ? data[0] : data;
  return NextResponse.json(toPayload(row));
}
