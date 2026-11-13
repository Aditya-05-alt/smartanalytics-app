import { NextResponse } from 'next/server';
import { findClientsNeedingTraffic, prepareVdpChangeRequest, syncTraffic, TRAFFIC_SYNC_CHUNK } from '../shared';

export const maxDuration = 120;

/** Dealers that still need GA4 traffic for ?month&compare (the page syncs them in chunks). */
export async function GET(request) {
  const { response, supabase, periods, dealers } = await prepareVdpChangeRequest(request);
  if (response) return response;
  try {
    const missing = await findClientsNeedingTraffic(supabase, periods, dealers.map((d) => d.clientId));
    return NextResponse.json({ periods, missing, chunkSize: TRAFFIC_SYNC_CHUNK });
  } catch (error) {
    console.error('[vdp-change/traffic]', error?.message);
    return NextResponse.json({ error: error?.message || 'Traffic check failed' }, { status: 500 });
  }
}

/** Sync GA4 traffic for one chunk of dealers: body { clientIds }. */
export async function POST(request) {
  const { response, supabase, periods, dealers } = await prepareVdpChangeRequest(request);
  if (response) return response;
  const body = await request.json().catch(() => ({}));
  const allowed = new Set(dealers.map((d) => d.clientId));
  const clientIds = (Array.isArray(body.clientIds) ? body.clientIds : [])
    .map(String)
    .filter((id) => allowed.has(id))
    .slice(0, TRAFFIC_SYNC_CHUNK);
  if (!clientIds.length) return NextResponse.json({ synced: 0, errors: [] });
  const errors = await syncTraffic(supabase, periods, clientIds);
  return NextResponse.json({ synced: clientIds.length, errors });
}
