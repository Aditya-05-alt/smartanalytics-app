import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { rpcByDateChunks } from '@/lib/api/chunkedRpc';
import { mergeChannelBreakdownRows } from '@/lib/ga4/channelBreakdownMerge';
import { dayCountInclusive } from '@/lib/ga4/dateRange';
import { parseInvRpcFromSearchParams } from '@/lib/vdp/vdpFilterParams';

export const maxDuration = 120;

/**
 * VDP Lab only — get_ga4_channel_breakdown_lab (location-aware).
 * Tries one full-range RPC first (matches diagnostic SQL); bisects on timeout.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get('clientId')?.trim();
  const from = searchParams.get('from')?.slice(0, 10);
  const to = searchParams.get('to')?.slice(0, 10);
  const pageType = searchParams.get('pageType')?.trim() || 'ALL';
  const inv = parseInvRpcFromSearchParams(searchParams);

  if (!clientId || !from || !to) {
    return NextResponse.json({ error: 'Missing clientId, from, or to' }, { status: 400 });
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

  const extraParams = {
    p_page_type: pageType,
    ...inv,
  };

  // Prefer one shot for the full range (simple join). On timeout, weekly chunks.
  const days = dayCountInclusive(from, to);
  const chunkDays = Math.max(days, 1);

  try {
    const raw = await rpcByDateChunks(supabase, 'get_ga4_channel_breakdown_lab', {
      clientId,
      from,
      to,
      extraParams,
      chunkDays,
      concurrency: 1,
    });

    const rows = mergeChannelBreakdownRows(raw);
    const totalViews = rows.reduce((s, r) => s + (Number(r.views) || 0), 0);

    return NextResponse.json({
      rows,
      meta: {
        source: 'rpc-lab',
        chunkDays,
        pageType,
        locationAware: true,
        locations: inv.p_locations || null,
        rowCount: rows.length,
        totalViews,
        hint:
          rows.length === 0 && inv.p_locations?.length
            ? 'Empty with location — redeploy get_ga4_channel_breakdown_lab.sql (Unassigned fallback).'
            : null,
      },
    });
  } catch (err) {
    const message = err?.message || 'Failed to load lab channel breakdown';
    const hint = /timeout|canceling statement/i.test(message)
      ? ' Statement timeout — try a shorter date range, or redeploy get_ga4_channel_breakdown_lab.sql.'
      : /function .*get_ga4_channel_breakdown_lab/i.test(message)
        ? ' Deploy supabase/rpc/get_ga4_channel_breakdown_lab.sql in Supabase.'
        : '';
    return NextResponse.json({ error: message + hint }, { status: 500 });
  }
}
