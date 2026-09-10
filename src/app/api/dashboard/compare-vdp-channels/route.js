import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const maxDuration = 60;

/**
 * Compare-page only: VDP channel matrix from ga4_compare_vdp_channel_daily.
 * Does not use All Dealers / Overview RPCs.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get('from')?.slice(0, 10);
  const to = searchParams.get('to')?.slice(0, 10);
  const clientIds = searchParams
    .getAll('clientId')
    .map((id) => id.trim())
    .filter(Boolean);

  if (!from || !to) {
    return NextResponse.json({ error: 'Missing from or to' }, { status: 400 });
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

  const { data, error } = await supabase.rpc('get_compare_vdp_channel_matrix', {
    p_from: from,
    p_to: to,
    p_client_ids: clientIds.length ? clientIds : null,
  });

  if (error) {
    console.error('[compare-vdp-channels]', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: data ?? [] });
}
