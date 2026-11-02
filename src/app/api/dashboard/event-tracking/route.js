import { NextResponse } from 'next/server';
import { rpcByDateChunks } from '@/lib/api/chunkedRpc';
import { isMissingRpcError, loadStoredUsers, prepareEventTrackingRequest } from './shared';

export const maxDuration = 120;

export async function GET(request) {
  const { response, supabase, periods, dealersByName, availableDealerNames } =
    await prepareEventTrackingRequest(request);
  if (response) return response;

  try {
    const results = await Promise.all(
      availableDealerNames.map(async (name) => {
        const dealer = dealersByName.get(name);
        let storedUsers;
        let finalRows;
        try {
          [storedUsers, finalRows] = await Promise.all([
            loadStoredUsers(supabase, dealer.clientId, periods),
            rpcByDateChunks(supabase, 'get_event_tracking_final_views', {
              clientId: dealer.clientId,
              from: periods.currentFrom,
              to: periods.currentTo,
            }),
          ]);
        } catch (error) {
          if (isMissingRpcError(error, 'get_event_tracking_final_views')) {
            throw new Error(
              'The final-views RPC is not deployed. Apply the Event Tracking final-views migration.'
            );
          }
          throw error;
        }
        if (!finalRows) {
          throw new Error('Could not load Event Tracking final VDP totals');
        }
        return {
          name,
          usersMissing: !storedUsers,
          users: storedUsers?.total ?? 0,
          views: finalRows.reduce((total, row) => total + (Number(row.views) || 0), 0),
        };
      })
    );

    return NextResponse.json({ dealers: results, availableDealerNames });
  } catch (error) {
    const message = error?.message || 'Failed to load Event Tracking metrics';
    console.error('[event-tracking]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
