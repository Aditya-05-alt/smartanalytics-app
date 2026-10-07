import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { rpcByDateChunks } from '@/lib/api/chunkedRpc';
import { mergeChannelBreakdownRows } from '@/lib/ga4/channelBreakdownMerge';
import { resolveRpcChunkPlan } from '@/lib/api/rpcChunkPlan';
import { mergeAnalyticsExtra } from '@/lib/api/analyticsScope';
import { parseInvRpcFromSearchParams } from '@/lib/vdp/vdpFilterParams';
import {
  canUseGa4Summary,
  canUseGa4VdpPaths,
  inventoryFiltersActive,
  singleCallPlan,
} from '@/lib/api/ga4SummaryPilot';

export const maxDuration = 120;

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

  let { chunkDays, concurrency } = resolveRpcChunkPlan(from, to, {
    invFilters,
    pageType,
  });

  try {
    if (inventoryFiltersActive(inv) && (await canUseGa4VdpPaths(supabase, clientId, from, to))) {
      ({ chunkDays, concurrency } = singleCallPlan(from, to));
    }

    if (!inventoryFiltersActive(inv) && (await canUseGa4Summary(supabase, clientId, from, to))) {
      const started = Date.now();
      const { data, error } = await supabase.rpc(
        'get_ga4_channel_breakdown_summary',
        mergeAnalyticsExtra(searchParams, {
          p_client_id: clientId,
          p_from: from,
          p_to: to,
          p_page_type: pageType,
          p_channels: inv.p_channels?.length ? inv.p_channels : null,
        })
      );
      if (!error) {
        return NextResponse.json({
          rows: mergeChannelBreakdownRows(data || []),
          meta: { source: 'ga4-summary', ms: Date.now() - started, pageType },
        });
      }
      console.warn('[channel-breakdown] summary path failed, using chunked RPC:', error.message);
    }

    const raw = await rpcByDateChunks(supabase, 'get_ga4_channel_breakdown', {
      clientId,
      from,
      to,
      extraParams: mergeAnalyticsExtra(searchParams, {
        p_page_type: pageType,
        ...inv,
      }),
      chunkDays,
      concurrency,
    });

    const rows = mergeChannelBreakdownRows(raw);

    return NextResponse.json({
      rows,
      meta: {
        source: 'chunked-rpc',
        chunkDays,
        pageType,
      },
    });
  } catch (err) {
    const message = err?.message || 'Failed to load channel breakdown';
    const hint = /timeout|canceling statement/i.test(message)
      ? ' Try a shorter date range or add indexes on smart_ga4_page_data (client_id, report_date).'
      : '';
    return NextResponse.json({ error: message + hint }, { status: 500 });
  }
}
