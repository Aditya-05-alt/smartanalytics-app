import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { runChunkedInventoryBreakdown } from '@/lib/api/inventoryBreakdownServer';

export const maxDuration = 120;

/**
 * Server-side location breakdown (service role + date-chunked RPC).
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
      rpcName: 'get_dealer_location_breakdown',
      fallbackRpc: 'get_location_breakdown',
      bucketKey: 'location_bucket',
    });
    return NextResponse.json({ data });
  } catch (err) {
    const message = err?.message || 'Failed to load location breakdown';
    const ga4PropertyId = searchParams.get('ga4PropertyId')?.trim();
    if (ga4PropertyId && /function.*does not exist|could not find the function/i.test(message)) {
      return NextResponse.json({ data: [] });
    }
    const hint = /timeout|canceling statement/i.test(message)
      ? ' Try a shorter date range or add indexes on smart_final_data (client_id, report_date).'
      : '';
    return NextResponse.json({ error: message + hint }, { status: 500 });
  }
}
