import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { parseInvRpcFromSearchParams } from '@/lib/vdp/vdpFilterParams';
import { RPC_CHUNK_DAYS, rpcByDateChunks } from '@/lib/api/chunkedRpc';

export const maxDuration = 120;

/** Always pass the full RPC arg set so PostgREST picks the correct overload. */
function buildVdpExportExtraParams(inv) {
  return {
    p_types: inv.p_types ?? null,
    p_makes: inv.p_makes ?? null,
    p_models: inv.p_models ?? null,
    p_locations: inv.p_locations ?? null,
    p_years: inv.p_years ?? null,
    p_condition: inv.p_condition ?? 'BOTH',
    p_channels: inv.p_channels ?? null,
  };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get('clientId')?.trim();
  const from = searchParams.get('from')?.slice(0, 10);
  const to = searchParams.get('to')?.slice(0, 10);

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

  const extraParams = buildVdpExportExtraParams(parseInvRpcFromSearchParams(searchParams));
  const fetchAll = (rpcName) =>
    rpcByDateChunks(supabase, rpcName, {
      clientId,
      from,
      to,
      extraParams,
      chunkDays: RPC_CHUNK_DAYS,
      concurrency: 2,
      paginate: true,
    });

  try {
    const [byChannel, byLocation, byMake, byModel, byCondition] = await Promise.all([
      fetchAll('get_vdp_export_by_channel'),
      fetchAll('get_vdp_export_by_location'),
      fetchAll('get_vdp_export_by_make'),
      fetchAll('get_vdp_export_by_model'),
      fetchAll('get_vdp_export_by_condition'),
    ]);

    return NextResponse.json({
      byChannel: byChannel || [],
      byLocation: byLocation || [],
      byMake: byMake || [],
      byModel: byModel || [],
      byCondition: byCondition || [],
      meta: { from, to, clientId },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err?.message || 'Failed to load VDP export data' },
      { status: 500 }
    );
  }
}
