import { createClient } from '@/lib/supabase/client';
import { aggregateLocationBuckets } from '@/lib/api/locationBreakdownAggregate';

const FINAL_DATA_TABLE = 'smart_final_data';
const LOCATION_PAGE_SIZE = 5000;

/**
 * GA4 OVERVIEW API
 * ----------------
 * IMPORTANT: never sum total_users / sessions / new_users from smart_ga4_page_data —
 * those are session-scoped metrics that get inflated when joined with page dimensions.
 * Use smart_ga4_data for user/session totals via fetchUserTotals().
 * Use smart_ga4_page_data only for views and per-page aggregations.
 */
export async function fetchOverviewRows({ clientId, from, to, onCancelCheck }) {
  const supabase = createClient();
  if (!supabase) throw new Error('Supabase is not configured.');
  if (onCancelCheck?.()) return null;

  const { data, error } = await supabase.rpc('get_ga4_overview', {
    p_client_id: clientId,
    p_from: from,
    p_to: to,
  });

  if (error) throw new Error(error.message || 'Failed to fetch overview data.');
  return data || [];
}

export async function fetchUserTotals({ clientId, from, to, onCancelCheck }) {
  const supabase = createClient();
  if (!supabase) throw new Error('Supabase is not configured.');
  if (onCancelCheck?.()) return null;

  const { data, error } = await supabase.rpc('get_ga4_user_totals', {
    p_client_id: clientId,
    p_from: from,
    p_to: to,
  });

  if (error) throw new Error(error.message || 'Failed to fetch user totals.');
  return data || [];
}

export async function fetchChannelBreakdown({
  clientId,
  from,
  to,
  pageTypeFilter = 'VDP',
  onCancelCheck,
}) {
  const supabase = createClient();
  if (!supabase) throw new Error('Supabase is not configured.');
  if (onCancelCheck?.()) return null;

  const { data, error } = await supabase.rpc('get_ga4_channel_breakdown', {
    p_client_id: clientId,
    p_from: from,
    p_to: to,
    p_page_type: pageTypeFilter,
  });

  if (error) throw new Error(error.message || 'Failed to fetch channel breakdown.');
  return data || [];
}

export async function fetchMakeBreakdown({
  clientId,
  from,
  to,
  limit = null,
  onCancelCheck,
}) {
  const supabase = createClient();
  if (!supabase) throw new Error('Supabase is not configured.');
  if (onCancelCheck?.()) return null;

  const params = {
    p_client_id: String(clientId).trim(),
    p_from: toDateOnly(from),
    p_to: toDateOnly(to),
    p_limit: limit,
  };

  const { data, error } = await supabase.rpc('get_make_breakdown', {
    ...params,
  });

  if (error) throw new Error(error.message || 'Failed to fetch make breakdown.');
  return data || [];
}

/** Model breakdown from smart_final_data (VDP tab only). */
export async function fetchModelBreakdown({
  clientId,
  from,
  to,
  limit = null,
  onCancelCheck,
}) {
  const supabase = createClient();
  if (!supabase) throw new Error('Supabase is not configured.');
  if (onCancelCheck?.()) return null;

  const { data, error } = await supabase.rpc('get_model_breakdown', {
    p_client_id: String(clientId).trim(),
    p_from: toDateOnly(from),
    p_to: toDateOnly(to),
    p_limit: limit,
  });

  if (error) throw new Error(error.message || 'Failed to fetch model breakdown.');
  return data || [];
}

/** Year breakdown from smart_final_data (VDP tab only). */
export async function fetchYearBreakdown({
  clientId,
  from,
  to,
  limit = null,
  onCancelCheck,
}) {
  const supabase = createClient();
  if (!supabase) throw new Error('Supabase is not configured.');
  if (onCancelCheck?.()) return null;

  const { data, error } = await supabase.rpc('get_year_breakdown', {
    p_client_id: String(clientId).trim(),
    p_from: toDateOnly(from),
    p_to: toDateOnly(to),
    p_limit: limit,
  });

  if (error) throw new Error(error.message || 'Failed to fetch year breakdown.');
  return data || [];
}

/** Condition breakdown from smart_final_data (VDP tab only). */
export async function fetchConditionBreakdown({
  clientId,
  from,
  to,
  limit = null,
  onCancelCheck,
}) {
  const supabase = createClient();
  if (!supabase) throw new Error('Supabase is not configured.');
  if (onCancelCheck?.()) return null;

  const { data, error } = await supabase.rpc('get_condition_breakdown', {
    p_client_id: String(clientId).trim(),
    p_from: toDateOnly(from),
    p_to: toDateOnly(to),
    p_limit: limit,
  });

  if (error) throw new Error(error.message || 'Failed to fetch condition breakdown.');
  return data || [];
}

/** Top campaigns by views from smart_ga4_page_data (not available on VDP tab). */
export async function fetchTopCampaigns({
  clientId,
  from,
  to,
  pageTypeFilter = 'ALL',
  limit = 10,
  onCancelCheck,
}) {
  const supabase = createClient();
  if (!supabase) throw new Error('Supabase is not configured.');
  if (onCancelCheck?.()) return null;

  const { data, error } = await supabase.rpc('get_top_campaigns', {
    p_client_id: String(clientId).trim(),
    p_from: toDateOnly(from),
    p_to: toDateOnly(to),
    p_page_type: pageTypeFilter,
    p_limit: limit,
  });

  if (error) throw new Error(error.message || 'Failed to fetch top campaigns.');
  return data || [];
}

function toDateOnly(value) {
  if (!value) return value;
  return String(value).slice(0, 10);
}

function normalizeLocationRows(data) {
  const list = Array.isArray(data) ? data : data ? [data] : [];
  return list.map((row) => ({
    location_bucket: String(
      row.location_bucket ?? row.location ?? row.inv_location ?? ''
    ),
    views: Number(row.views ?? row.view_count ?? 0) || 0,
    pct: Number(row.pct ?? row.percentage ?? 0) || 0,
    rank: Number(row.rank ?? row.rn ?? 999) || 999,
  }));
}

async function fetchLocationFromTable(supabase, params, onCancelCheck) {
  let offset = 0;
  const buffer = [];

  while (true) { // eslint-disable-line no-constant-condition
    if (onCancelCheck?.()) return undefined;

    const { data, error } = await supabase
      .from(FINAL_DATA_TABLE)
      .select('inv_location, views')
      .eq('client_id', params.p_client_id)
      .gte('report_date', params.p_from)
      .lte('report_date', params.p_to)
      .range(offset, offset + LOCATION_PAGE_SIZE - 1);

    if (error) return null;
    if (!data?.length) break;

    buffer.push(...data);
    if (data.length < LOCATION_PAGE_SIZE) break;
    offset += LOCATION_PAGE_SIZE;
  }

  return aggregateLocationBuckets(buffer);
}

/** Server route using service role when anon RPC returns [] (RLS). */
async function fetchLocationBreakdownViaApi(params, onCancelCheck) {
  if (onCancelCheck?.()) return undefined;
  if (typeof window === 'undefined') return null;

  const qs = new URLSearchParams({
    clientId: params.p_client_id,
    from: params.p_from,
    to: params.p_to,
  });

  try {
    const res = await fetch(`/api/dashboard/location-breakdown?${qs}`);
    if (!res.ok) return null;
    const json = await res.json();
    if (onCancelCheck?.()) return undefined;
    return normalizeLocationRows(json.data);
  } catch {
    return null;
  }
}

/**
 * Location breakdown — get_location_breakdown RPC (3 params; optional filters omitted).
 * Falls back to server API (service role) then direct table read if RPC returns [].
 */
export async function fetchLocationBreakdown({
  clientId,
  from,
  to,
  onCancelCheck,
}) {
  const supabase = createClient();
  if (!supabase) throw new Error('Supabase is not configured.');
  if (onCancelCheck?.()) return undefined;

  const params = {
    p_client_id: String(clientId).trim(),
    p_from: toDateOnly(from),
    p_to: toDateOnly(to),
  };

  const { data, error } = await supabase.rpc('get_location_breakdown', params);

  if (error) throw new Error(error.message || 'Failed to fetch location breakdown.');
  if (onCancelCheck?.()) return undefined;

  const rpcRows = normalizeLocationRows(data);
  if (rpcRows.length > 0) return rpcRows;

  const apiRows = await fetchLocationBreakdownViaApi(params, onCancelCheck);
  if (onCancelCheck?.()) return undefined;
  if (apiRows?.length) return apiRows;

  const tableRows = await fetchLocationFromTable(supabase, params, onCancelCheck);
  if (onCancelCheck?.()) return undefined;
  if (tableRows?.length) return tableRows;

  return rpcRows;
}

/** Active dealers from smart_hoot_config (same source as ClientContext). */
export async function fetchActiveDealers() {
  const supabase = createClient();
  if (!supabase) throw new Error('Supabase is not configured.');

  const { data, error } = await supabase
    .from('smart_hoot_config')
    .select(
      'id, customer_name, hoot_id, hoot_url, ga4_customer_id, website_platform, is_active'
    )
    .eq('is_active', true)
    .order('customer_name', { ascending: true });

  if (error) throw new Error(error.message || 'Failed to load dealers.');

  return (data || [])
    .filter((r) => r && r.customer_name)
    .map((row) => ({
      id: row.id,
      name: row.customer_name || 'Unnamed dealer',
      ga4CustomerId: row.ga4_customer_id || null,
      hootId: row.hoot_id || null,
      websitePlatform: row.website_platform || null,
    }));
}
