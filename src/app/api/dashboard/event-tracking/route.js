import { NextResponse } from 'next/server';
import { rpcAllRows } from '@/lib/api/chunkedRpc';
import { prepareEventTrackingRequest } from './shared';
import { findClientsNeedingUsers, syncUsers } from './usersSync';

export const maxDuration = 120;

/**
 * Every dealer's Event Tracking data for a date range in one call
 * (get_event_tracking_dashboard): GA4 total users, Final VDP views and form events by channel.
 */
export async function GET(request) {
  const { response, supabase, from, to, dealers } = await prepareEventTrackingRequest(request);
  if (response) return response;

  const clientIds = dealers.map((dealer) => dealer.clientId);
  let rows;
  try {
    // The page syncs users in chunks first (users route); this only covers direct calls.
    const needUsers = await findClientsNeedingUsers(supabase, from, to, clientIds);
    if (needUsers.length) await syncUsers(supabase, from, to, needUsers);
    rows = await rpcAllRows(supabase, 'get_event_tracking_dashboard', {
      p_from: from,
      p_to: to,
      p_client_ids: clientIds,
    });
  } catch (error) {
    console.error('[event-tracking]', error?.message);
    return NextResponse.json(
      { error: error?.message || 'Failed to load Event Tracking data' },
      { status: 500 }
    );
  }

  const byClient = new Map(
    dealers.map((dealer) => [
      dealer.clientId,
      {
        id: dealer.dealerId,
        name: dealer.name,
        clientId: dealer.clientId,
        users: 0,
        usersMissing: true,
        views: 0,
        channels: new Map(),
        eventTotals: {},
        eventsByChannel: {},
      },
    ])
  );
  const channelEntry = (dealer, name) => {
    if (!dealer.channels.has(name)) dealer.channels.set(name, { name, users: 0, views: 0 });
    return dealer.channels.get(name);
  };

  for (const row of rows) {
    const dealer = byClient.get(String(row.client_id));
    if (!dealer) continue;
    const value = Number(row.value) || 0;
    if (row.kind === 'users') {
      dealer.usersMissing = false;
      if (row.channel === '(all)') dealer.users = value;
      else channelEntry(dealer, row.channel).users += value;
    } else if (row.kind === 'vdp') {
      dealer.views += value;
      channelEntry(dealer, row.channel).views += value;
    } else if (row.kind === 'event') {
      dealer.eventTotals[row.event_name] = (dealer.eventTotals[row.event_name] || 0) + value;
      dealer.eventsByChannel[row.channel] ||= {};
      dealer.eventsByChannel[row.channel][row.event_name] =
        (dealer.eventsByChannel[row.channel][row.event_name] || 0) + value;
    }
  }

  return NextResponse.json({
    from,
    to,
    dealers: [...byClient.values()].map(({ channels, ...dealer }) => ({
      ...dealer,
      rows: [...channels.values()],
    })),
  });
}
