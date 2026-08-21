import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { rpcByDateChunks } from '@/lib/api/chunkedRpc';
import { mergeChannelBreakdownRows } from '@/lib/ga4/channelBreakdownMerge';
import { resolveRpcChunkPlan } from '@/lib/api/rpcChunkPlan';
import { parseInvRpcFromSearchParams } from '@/lib/vdp/vdpFilterParams';

export const maxDuration = 120;

/**
 * VDP Lab only — get_ga4_channel_breakdown_lab.
 * Same chunking plan as live channel-breakdown (not one giant full-range RPC).
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get('clientId')?.trim();
  const from = searchParams.get('from')?.slice(0, 10);
  const to = searchParams.get('to')?.slice(0, 10);
  const pageType = searchParams.get('pageType')?.trim() || 'ALL';
  const inv = parseInvRpcFromSearchParams(searchParams);
  const invFilters = Boolean(
    inv.p_years?.length ||
      inv.p_makes?.length ||
      inv.p_models?.length ||
      inv.p_types?.length ||
      inv.p_locations?.length ||
      inv.p_channels?.length ||
      (inv.p_condition && inv.p_condition !== 'BOTH')
  );

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

  const { chunkDays, concurrency } = resolveRpcChunkPlan(from, to, {
    invFilters,
    pageType,
  });

  try {
    const raw = await rpcByDateChunks(supabase, 'get_ga4_channel_breakdown_lab', {
      clientId,
      from,
      to,
      extraParams: {
        p_page_type: pageType,
        ...inv,
      },
      chunkDays,
      concurrency,
    });

    const rows = mergeChannelBreakdownRows(raw);
    const totalViews = rows.reduce((s, r) => s + (Number(r.views) || 0), 0);

    return NextResponse.json({
      rows,
      meta: {
        source: 'chunked-rpc-lab',
        chunkDays,
        concurrency,
        pageType,
        locations: inv.p_locations || null,
        rowCount: rows.length,
        totalViews,
      },
    });
  } catch (err) {
    const message = err?.message || 'Failed to load lab channel breakdown';
    const hint = /timeout|canceling statement/i.test(message)
      ? ' Statement timeout — redeploy get_ga4_channel_breakdown_lab.sql and retry.'
      : /function .*get_ga4_channel_breakdown_lab/i.test(message)
        ? ' Deploy supabase/rpc/get_ga4_channel_breakdown_lab.sql in Supabase.'
        : '';
    return NextResponse.json({ error: message + hint }, { status: 500 });
  }
}
