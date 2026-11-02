import { NextResponse } from 'next/server';
import { formatChannelName, isMissingRpcError, prepareEventTrackingRequest } from '../shared';

export const maxDuration = 60;

async function callRpc(supabase, name, clientId, periods) {
  const { data, error } = await supabase.rpc(name, {
    p_client_id: clientId,
    p_from: periods.currentFrom,
    p_to: periods.currentTo,
  });
  if (error) throw error;
  return data || [];
}

export async function GET(request) {
  const { response, supabase, periods, dealersByName, availableDealerNames } =
    await prepareEventTrackingRequest(request);
  if (response) return response;

  try {
    const results = await Promise.all(
      availableDealerNames.map(async (name) => {
        const dealer = dealersByName.get(name);
        let totalRows;
        let channelRows;
        try {
          [totalRows, channelRows] = await Promise.all([
            callRpc(supabase, 'get_event_tracking_event_totals', dealer.clientId, periods),
            callRpc(supabase, 'get_event_tracking_event_channel_totals', dealer.clientId, periods),
          ]);
        } catch (error) {
          if (isMissingRpcError(error, 'get_event_tracking_event_(totals|channel_totals)')) {
            throw new Error(
              'An Event Tracking events RPC is not deployed. Apply the events RPCs migration.'
            );
          }
          throw error;
        }

        const eventTotals = {};
        for (const row of totalRows) {
          eventTotals[row.event_name] = Number(row.event_count) || 0;
        }
        const eventsByChannel = {};
        for (const row of channelRows) {
          const channel = formatChannelName(row.channel);
          eventsByChannel[channel] ||= {};
          eventsByChannel[channel][row.event_name] =
            (eventsByChannel[channel][row.event_name] || 0) + (Number(row.event_count) || 0);
        }
        return { name, eventTotals, eventsByChannel };
      })
    );

    return NextResponse.json({ dealers: results });
  } catch (error) {
    const message = error?.message || 'Failed to load Event Tracking events';
    console.error('[event-tracking/events]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
