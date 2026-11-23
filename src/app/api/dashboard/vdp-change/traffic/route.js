import { NextResponse } from 'next/server';
import {
  findClientsNeedingTraffic,
  prepareVdpChangeRequest,
  syncMissingTraffic,
  syncTraffic,
  TRAFFIC_SYNC_CHUNK,
  TRAFFIC_SYNC_CONCURRENCY,
} from '../shared';

export const maxDuration = 120;

/** Dealers that still need GA4 traffic for the selected range. */
export async function GET(request) {
  const { response, supabase, periods, dealers } = await prepareVdpChangeRequest(request);
  if (response) return response;
  try {
    const refreshStale = new URL(request.url).searchParams.get('refreshStale') === '1';
    const missing = await findClientsNeedingTraffic(
      supabase,
      periods,
      dealers.map((d) => d.clientId),
      { refreshStale },
    );
    return NextResponse.json({
      periods,
      missing,
      chunkSize: TRAFFIC_SYNC_CHUNK,
      concurrency: TRAFFIC_SYNC_CONCURRENCY,
    });
  } catch (error) {
    console.error('[vdp-change/traffic]', error?.message);
    return NextResponse.json({ error: error?.message || 'Traffic check failed' }, { status: 500 });
  }
}

/**
 * Sync GA4 traffic.
 * Body: { syncAllMissing: true } — sync every dealer still missing for this range (preferred).
 * Or { clientIds: string[] } — sync one chunk (legacy).
 */
export async function POST(request) {
  const { response, supabase, periods, dealers } = await prepareVdpChangeRequest(request);
  if (response) return response;
  const body = await request.json().catch(() => ({}));
  const allowed = dealers.map((d) => d.clientId);

  if (body.syncAllMissing) {
    try {
      const result = await syncMissingTraffic(supabase, periods, allowed);
      return NextResponse.json({ synced: result.missing, errors: result.errors });
    } catch (error) {
      console.error('[vdp-change/traffic]', error?.message);
      return NextResponse.json({ error: error?.message || 'Traffic sync failed' }, { status: 500 });
    }
  }

  const allowedSet = new Set(allowed);
  const clientIds = (Array.isArray(body.clientIds) ? body.clientIds : [])
    .map(String)
    .filter((id) => allowedSet.has(id))
    .slice(0, TRAFFIC_SYNC_CHUNK);
  if (!clientIds.length) return NextResponse.json({ synced: 0, errors: [] });
  const errors = await syncTraffic(supabase, periods, clientIds);
  return NextResponse.json({ synced: clientIds.length, errors });
}
