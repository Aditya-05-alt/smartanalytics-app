import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

/**
 * Long ranges are fetched in day chunks so each GA4 scan stays under
 * statement_timeout. With idx_ga4_page_vdp_date_prop, a full month is ~25s;
 * chunk only when the span exceeds one month.
 */
export const maxDuration = 180;

const CHUNK_DAYS = 31;

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

function daySpan(from, to) {
  const a = new Date(`${from}T00:00:00`);
  const b = new Date(`${to}T00:00:00`);
  return Math.round((b - a) / 86400000) + 1;
}

/** Split inclusive [from, to] into chunks of CHUNK_DAYS. */
function dateChunks(from, to, chunkDays = CHUNK_DAYS) {
  const chunks = [];
  let start = from;
  while (start <= to) {
    const end = addDaysYmd(start, chunkDays - 1);
    chunks.push({ from: start, to: end > to ? to : end });
    start = addDaysYmd(chunks[chunks.length - 1].to, 1);
  }
  return chunks;
}

function mapRpcRow(row, from, to) {
  return {
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
  };
}

function mergeChunkRows(chunkRows, rangeFrom, rangeTo) {
  const byProp = new Map();

  for (const row of chunkRows) {
    const key = row.propertyId || `name:${row.accountName}`;
    const prev = byProp.get(key);
    if (!prev) {
      byProp.set(key, {
        ...row,
        rangeFrom,
        rangeTo,
      });
      continue;
    }
    prev.ga4VdpViews += row.ga4VdpViews;
    prev.bigqVdpViews += row.bigqVdpViews;
    if (!prev.accountName || prev.accountName.startsWith('Unmapped')) {
      if (row.accountName && !row.accountName.startsWith('Unmapped')) {
        prev.accountName = row.accountName;
      }
    }
    if (!prev.clientId && row.clientId) prev.clientId = row.clientId;
    prev.onReport = prev.onReport || row.onReport;
  }

  return [...byProp.values()].map((row) => {
    const ga4 = row.ga4VdpViews;
    const bigq = row.bigqVdpViews;
    const delta = bigq - ga4;
    let deltaPct = null;
    if (ga4 === 0 && bigq === 0) deltaPct = 0;
    else if (ga4 !== 0) deltaPct = Math.round((10000 * delta) / ga4) / 100;

    let matchStatus = 'other';
    if (row.onReport && bigq > 0 && ga4 > 0) matchStatus = 'matched';
    else if (!row.onReport && bigq > 0) matchStatus = 'missing_from_report';
    else if (bigq === 0 && ga4 > 0) matchStatus = 'ga4_only';
    else if (ga4 === 0 && bigq > 0) matchStatus = 'bigq_only';

    return {
      ...row,
      deltaViews: delta,
      deltaPct,
      matchStatus,
      rangeFrom,
      rangeTo,
    };
  }).sort((a, b) => {
    const rank = (s) =>
      s === 'missing_from_report' ? 0 : s === 'ga4_only' ? 1 : 2;
    const ra = rank(a.matchStatus);
    const rb = rank(b.matchStatus);
    if (ra !== rb) return ra - rb;
    return Math.abs(b.deltaViews) - Math.abs(a.deltaViews);
  });
}

/**
 * VDP Lab — all-dealer VDP views compare (includes BigQ dealers missing from report).
 * Long date ranges are fetched in 7-day chunks and merged so each DB call stays under timeout.
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
    const span = daySpan(from, to);
    const chunks = span > CHUNK_DAYS ? dateChunks(from, to, CHUNK_DAYS) : [{ from, to }];

    const chunkResults = [];
    // Sequential chunks avoid saturating DB; each week is ~15–25s before the VDP index exists.
    for (const chunk of chunks) {
      const { data, error } = await supabase.rpc('compare_vdp_ga4_vs_bigq', {
        p_from: chunk.from,
        p_to: chunk.to,
      });
      if (error) {
        return NextResponse.json(
          { error: error.message || 'compare_vdp_ga4_vs_bigq failed' },
          { status: 500 }
        );
      }
      chunkResults.push(...(data || []).map((row) => mapRpcRow(row, from, to)));
    }

    let rows =
      chunks.length === 1
        ? chunkResults
        : mergeChunkRows(chunkResults, from, to);

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
        from,
        to,
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
        chunks: chunks.length,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err?.message || 'Failed to compare VDP sources' },
      { status: 500 }
    );
  }
}
