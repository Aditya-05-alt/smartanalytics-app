import { NextResponse } from 'next/server';
import { prepareEventTrackingRequest } from '../shared';
import { findClientsNeedingUsers, syncUsers, USERS_SYNC_CHUNK } from '../usersSync';

export const maxDuration = 120;

/** Dealers that still need GA4 total users for ?from&to (the page syncs them in chunks). */
export async function GET(request) {
  const { response, supabase, from, to, dealers } = await prepareEventTrackingRequest(request);
  if (response) return response;
  try {
    const missing = await findClientsNeedingUsers(
      supabase,
      from,
      to,
      dealers.map((dealer) => dealer.clientId)
    );
    return NextResponse.json({ missing, chunkSize: USERS_SYNC_CHUNK });
  } catch (error) {
    console.error('[event-tracking/users]', error?.message);
    return NextResponse.json({ error: error?.message || 'Users check failed' }, { status: 500 });
  }
}

/** Sync GA4 total users for one chunk of dealers: body { clientIds }. */
export async function POST(request) {
  const { response, supabase, from, to, dealers } = await prepareEventTrackingRequest(request);
  if (response) return response;

  const body = await request.json().catch(() => ({}));
  const allowed = new Set(dealers.map((dealer) => dealer.clientId));
  const clientIds = (Array.isArray(body.clientIds) ? body.clientIds : [])
    .map(String)
    .filter((id) => allowed.has(id))
    .slice(0, USERS_SYNC_CHUNK);
  if (!clientIds.length) return NextResponse.json({ synced: 0, errors: [] });

  const errors = await syncUsers(supabase, from, to, clientIds);
  return NextResponse.json({ synced: clientIds.length, errors });
}
