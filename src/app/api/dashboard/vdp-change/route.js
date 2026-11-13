import { NextResponse } from 'next/server';
import { rpcAllRows } from '@/lib/api/chunkedRpc';
import { prepareVdpChangeRequest } from './shared';

export const maxDuration = 120;

/**
 * Every dealer's VDP Change inputs for ?month&compare (get_vdp_change): per channel group and
 * period, GA4 users / sessions / page views and Final VDP views, plus average in-stock units.
 */
export async function GET(request) {
  const { response, supabase, periods, dealers } = await prepareVdpChangeRequest(request);
  if (response) return response;

  let rows;
  let rates;
  try {
    [rows, rates] = await Promise.all([
      rpcAllRows(supabase, 'get_vdp_change', {
        p_from: periods.from,
        p_to: periods.to,
        p_prev_from: periods.prevFrom,
        p_prev_to: periods.prevTo,
        p_client_ids: dealers.map((d) => d.clientId),
      }),
      supabase.from('smart_vdp_change_rates').select('grp, rate, basis').then(({ data, error }) => {
        if (error) throw error;
        return data || [];
      }),
    ]);
  } catch (error) {
    console.error('[vdp-change]', error?.message);
    return NextResponse.json({ error: error?.message || 'Failed to load VDP Change data' }, { status: 500 });
  }

  const byClient = new Map(
    dealers.map((d) => [d.clientId, { ...d, cur: {}, prev: {}, stock: { cur: null, prev: null } }])
  );
  for (const row of rows) {
    const dealer = byClient.get(String(row.client_id));
    if (!dealer) continue;
    if (row.grp === '(stock)') {
      dealer.stock[row.period] = row.stock == null ? null : Number(row.stock);
      continue;
    }
    dealer[row.period][row.grp] = {
      users: Number(row.users) || 0,
      sessions: Number(row.sessions) || 0,
      pageViews: Number(row.page_views) || 0,
      vdp: Number(row.vdp) || 0,
    };
  }

  return NextResponse.json({
    periods,
    rates: rates.map((r) => ({ grp: r.grp, rate: Number(r.rate), basis: r.basis })),
    dealers: [...byClient.values()],
  });
}
