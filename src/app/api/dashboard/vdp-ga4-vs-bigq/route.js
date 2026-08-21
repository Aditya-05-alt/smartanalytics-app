import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const maxDuration = 60;

function ymd(d) {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  try {
    return d.toISOString().slice(0, 10);
  } catch {
    return String(d).slice(0, 10);
  }
}

function localYmd(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDaysYmd(ymdStr, days) {
  const [y, m, d] = ymdStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return localYmd(dt);
}

/**
 * VDP Lab — all-dealer VDP views compare (includes BigQ dealers missing from report).
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const capTo = addDaysYmd(localYmd(), -2);
  let from = searchParams.get('from')?.slice(0, 10) || null;
  let to = searchParams.get('to')?.slice(0, 10) || null;
  const statusFilter = searchParams.get('status')?.trim() || 'all';

  if (!to) to = capTo;
  if (to > capTo) to = capTo;
  if (!from) from = addDaysYmd(to, -6);
  if (from > to) from = to;

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
    const { data, error } = await supabase.rpc('compare_vdp_ga4_vs_bigq', {
      p_from: from,
      p_to: to,
    });

    if (error) {
      return NextResponse.json(
        { error: error.message || 'compare_vdp_ga4_vs_bigq failed' },
        { status: 500 }
      );
    }

    let rows = (data || []).map((row) => ({
      clientId: row.client_id ? String(row.client_id) : null,
      accountName: row.account_name || `Unmapped · ${row.property_id || '?'}`,
      propertyId: row.property_id ? String(row.property_id) : null,
      ga4VdpViews: Number(row.ga4_vdp_views) || 0,
      bigqVdpViews: Number(row.bigq_vdp_views) || 0,
      deltaViews: Number(row.delta_views) || 0,
      deltaPct:
        row.delta_pct == null || row.delta_pct === ''
          ? null
          : Number(row.delta_pct),
      matchStatus: row.match_status || 'other',
      onReport: Boolean(row.on_report),
      rangeFrom: ymd(row.range_from) || from,
      rangeTo: ymd(row.range_to) || to,
    }));

    if (statusFilter && statusFilter !== 'all') {
      rows = rows.filter((r) => r.matchStatus === statusFilter);
    }

    const ga4Total = rows.reduce((s, r) => s + r.ga4VdpViews, 0);
    const bigqTotal = rows.reduce((s, r) => s + r.bigqVdpViews, 0);
    const deltaTotal = bigqTotal - ga4Total;
    const missingCount = rows.filter(
      (r) => r.matchStatus === 'missing_from_report'
    ).length;

    return NextResponse.json({
      rows,
      meta: {
        from: rows[0]?.rangeFrom || from,
        to: rows[0]?.rangeTo || to,
        bigqCapTo: capTo,
        dealerCount: rows.length,
        missingFromReport: missingCount,
        statusFilter,
        ga4Total,
        bigqTotal,
        deltaTotal,
        deltaPctTotal:
          ga4Total === 0
            ? bigqTotal === 0
              ? 0
              : null
            : Math.round((10000 * deltaTotal) / ga4Total) / 100,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err?.message || 'Failed to compare VDP sources' },
      { status: 500 }
    );
  }
}
