import { NextResponse } from 'next/server';
import { rpcByDateChunks } from '@/lib/api/chunkedRpc';
import {
  formatChannelName,
  isMissingRpcError,
  loadStoredUsers,
  prepareEventTrackingRequest,
} from '../shared';

export const maxDuration = 120;

// Views: allocation is per (report_date, page_path), so per-window results sum exactly.
// Users: GA4 totalUsers per channel for the whole month (smart_events_users).
function mergeChannelRows(rows, storedUsers) {
  const byChannel = new Map();
  const entryFor = (name) => {
    if (!byChannel.has(name)) byChannel.set(name, { name, users: 0, views: 0 });
    return byChannel.get(name);
  };
  for (const row of rows) {
    entryFor(formatChannelName(row.channel)).views += Number(row.final_views) || 0;
  }
  for (const [name, users] of storedUsers?.byChannel || []) {
    entryFor(name).users = users;
  }
  return [...byChannel.values()].map(({ name, users, views }) => ({
    name,
    users: [users, 0, 0],
    views: [views, 0, 0],
    events: [0, 0, 0],
  }));
}

export async function GET(request) {
  const { response, supabase, periods, dealersByName, availableDealerNames } =
    await prepareEventTrackingRequest(request);
  if (response) return response;

  try {
    const results = await Promise.all(
      availableDealerNames.map(async (name) => {
        const dealer = dealersByName.get(name);
        let rows;
        let storedUsers;
        try {
          [rows, storedUsers] = await Promise.all([
            rpcByDateChunks(supabase, 'get_event_tracking_channel_metrics', {
              clientId: dealer.clientId,
              from: periods.currentFrom,
              to: periods.currentTo,
            }),
            loadStoredUsers(supabase, dealer.clientId, periods),
          ]);
        } catch (error) {
          if (isMissingRpcError(error, 'get_event_tracking_channel_metrics')) {
            throw new Error(
              'The channel-metrics RPC is not deployed. Apply the Event Tracking channel-metrics migration.'
            );
          }
          throw error;
        }
        if (!rows) throw new Error('Could not load Event Tracking channel metrics');
        return {
          name,
          usersMissing: !storedUsers,
          rows: mergeChannelRows(rows, storedUsers),
        };
      })
    );

    return NextResponse.json({ dealers: results });
  } catch (error) {
    const message = error?.message || 'Failed to load Event Tracking channel metrics';
    console.error('[event-tracking/channels]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
