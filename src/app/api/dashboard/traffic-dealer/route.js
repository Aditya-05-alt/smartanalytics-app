import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const maxDuration = 30;

/** Active Scout RV / ScoutRV dealers. ScoutX (Peak Honda) is a different CMS. */
const SCOUT_DEALERS = [
  { clientId: '2728830488', name: 'A&L RV Sales' },
  { clientId: '3759117472', name: 'Clearcreek RVs TX' },
  { clientId: '2360685226', name: 'Coastal RV' },
  { clientId: '1162028739', name: "Gerzeny's RV" },
  { clientId: '5152307309', name: 'Happy Camper RV' },
  { clientId: '8841710958', name: 'Johnston RV' },
  { clientId: '5592824688', name: 'Pierce Rv Great Falls' },
  { clientId: '2562396503', name: 'Ricks RV' },
  { clientId: '9842851162', name: 'Sky River RV' },
  { clientId: '9080903239', name: 'Southland RV' },
  { clientId: '4668711550', name: 'Trailer Source Inc' },
  { clientId: '7231326744', name: 'XGRID Campers' },
  { clientId: '5691491478', name: 'Zoomers Rv' },
];

const CHANNEL_LABELS = {
  paid_search: 'Paid Search',
  organic_search: 'Organic Search',
  organic_social: 'Organic Social',
  paid_social: 'Paid Social',
  direct: 'Direct',
  cross_network: 'Cross-network',
  referral: 'Referral',
  email: 'Email',
  display: 'Display',
  paid_video: 'Paid Video',
  organic_video: 'Organic Video',
  ai_assistant: 'AI Assistant',
  unassigned: 'Unassigned',
  organic_shopping: 'Organic Shopping',
  paid_other: 'Paid Other',
  sms: 'SMS',
};

function labelChannel(raw) {
  const key = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (CHANNEL_LABELS[key]) return CHANNEL_LABELS[key];
  if (!raw || !String(raw).trim()) return '(not set)';
  return String(raw)
    .trim()
    .replace(/[_-]+/g, ' ')
    .split(/\s+/)
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(' ');
}

function ratio(numerator, denominator) {
  const den = Number(denominator) || 0;
  if (den <= 0) return 0;
  return Math.round(((Number(numerator) || 0) / den) * 100) / 100;
}

function rollupDealer(rows) {
  const channels = new Map();
  let sessions = 0;
  let users = 0;
  let pageViews = 0;
  let vdp = 0;

  for (const row of rows || []) {
    const name = labelChannel(row.channel);
    const cur = channels.get(name) || {
      sessions: 0,
      users: 0,
      pageViews: 0,
      vdp: 0,
    };
    cur.sessions += Number(row.sessions) || 0;
    cur.users += Number(row.users) || 0;
    cur.pageViews += Number(row.page_views) || 0;
    cur.vdp += Number(row.vdp_views) || 0;
    channels.set(name, cur);
    sessions += Number(row.sessions) || 0;
    users += Number(row.users) || 0;
    pageViews += Number(row.page_views) || 0;
    vdp += Number(row.vdp_views) || 0;
  }

  const channelList = [...channels.entries()]
    .map(([name, metrics]) => ({ name, ...metrics }))
    .sort((a, b) => b.vdp - a.vdp || a.name.localeCompare(b.name));

  return {
    users,
    sessions,
    pageViews,
    vdp,
    sessionsPerUser: ratio(sessions, users),
    pagesPerSession: ratio(pageViews, sessions),
    viewsPerSession: ratio(vdp, sessions),
    channels: Object.fromEntries(
      channelList.map((c) => [
        c.name,
        {
          sessions: c.sessions,
          users: c.users,
          pageViews: c.pageViews,
          vdp: c.vdp,
        },
      ])
    ),
    channelOrder: channelList.map((c) => c.name),
  };
}

function groupByDealer(rows) {
  const byId = new Map();
  for (const row of rows || []) {
    const id = String(row.client_id);
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(row);
  }
  return byId;
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function loadRange(supabase, from, to) {
  const { data, error } = await supabase.rpc('get_traffic_dealers_channels', {
    p_client_ids: SCOUT_DEALERS.map((d) => d.clientId),
    p_from: from,
    p_to: to,
  });
  if (error) throw new Error(error.message);
  return groupByDealer(data);
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const compareFrom = searchParams.get('compareFrom');
  const compareTo = searchParams.get('compareTo');

  if (!from || !to) {
    return NextResponse.json({ error: 'Missing from or to' }, { status: 400 });
  }

  const supabase = serviceClient();
  if (!supabase) {
    return NextResponse.json(
      { error: 'SUPABASE_SERVICE_ROLE_KEY is not configured on the server' },
      { status: 503 }
    );
  }

  try {
    const [currentByDealer, compareByDealer] = await Promise.all([
      loadRange(supabase, from, to),
      compareFrom && compareTo
        ? loadRange(supabase, compareFrom, compareTo)
        : Promise.resolve(null),
    ]);

    const dealers = SCOUT_DEALERS.map((dealer) => ({
      clientId: dealer.clientId,
      name: dealer.name,
      current: rollupDealer(currentByDealer.get(dealer.clientId) || []),
      compare: compareByDealer
        ? rollupDealer(compareByDealer.get(dealer.clientId) || [])
        : null,
    })).sort((a, b) => a.name.localeCompare(b.name));

    const channelTotals = new Map();
    for (const dealer of dealers) {
      for (const [name, metrics] of Object.entries(dealer.current.channels || {})) {
        const vdp = Number(metrics?.vdp ?? metrics) || 0;
        channelTotals.set(name, (channelTotals.get(name) || 0) + vdp);
      }
    }
    const channelOrder = [...channelTotals.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name]) => name);

    return NextResponse.json({
      group: 'Scout RV',
      from,
      to,
      dealers,
      channelOrder,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err?.message || 'Failed to load Scout RV traffic' },
      { status: 500 }
    );
  }
}
