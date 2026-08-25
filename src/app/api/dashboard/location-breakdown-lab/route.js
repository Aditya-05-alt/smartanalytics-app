import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { runChunkedInventoryBreakdown } from '@/lib/api/inventoryBreakdownServer';

export const maxDuration = 120;

/**
 * VDP Lab only — chunked get_dealer_location_breakdown_lab / get_location_breakdown_lab.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get('clientId');
  const from = searchParams.get('from');
  const to = searchParams.get('to');

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

  try {
    const data = await runChunkedInventoryBreakdown(supabase, searchParams, {
      rpcName: 'get_dealer_location_breakdown_lab',
      fallbackRpc: 'get_location_breakdown_lab',
      bucketKey: 'location_bucket',
    });
    return NextResponse.json({ data, meta: { source: 'lab-chunked', locationAware: true } });
  } catch (err) {
    const message = err?.message || 'Failed to load location breakdown (lab)';
    const hint = /function.*does not exist|could not find the function|schema cache/i.test(
      message
    )
      ? ' Deploy get_location_breakdown_lab.sql and get_dealer_location_breakdown_lab.sql.'
      : '';
    return NextResponse.json({ error: message + hint }, { status: 500 });
  }
}
