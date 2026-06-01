import { isVdpPageRow } from '@/lib/ga4/classifyPage';

const PAGE_TABLE = 'smart_ga4_page_data';
const FINAL_TABLE = 'smart_final_data';
/** PostgREST / Supabase default max rows per request */
const FETCH_SIZE = 1000;
const DAY_CONCURRENCY = 6;

async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * Paginate and sum views for one report_date.
 */
async function sumViewsForSingleDay(supabase, clientId, day, table, opts = {}) {
  const vdpOnly = opts.vdpOnly === true;
  let offset = 0;
  let total = 0;

  while (true) {
    let query = supabase
      .from(table)
      .select('views')
      .eq('client_id', clientId)
      .eq('report_date', day)
      .order('page_path', { ascending: true })
      .range(offset, offset + FETCH_SIZE - 1);

    if (vdpOnly && table === PAGE_TABLE) {
      query = query.eq('vdp_conditions', true);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    if (!data?.length) break;

    for (const row of data) {
      total += Number(row.views) || 0;
    }

    if (data.length < FETCH_SIZE) break;
    offset += FETCH_SIZE;
  }

  return total;
}

/**
 * Sum views by report_date for each day in `days` (parallel batches).
 * Days with no rows are omitted (UI shows empty).
 */
async function sumViewsByDays(supabase, clientId, days, table, opts = {}) {
  const daily = {};
  if (!clientId || !days?.length) return daily;

  await mapPool(days, DAY_CONCURRENCY, async (day) => {
    const total = await sumViewsForSingleDay(supabase, clientId, day, table, opts);
    if (total > 0) daily[day] = total;
  });

  return daily;
}

/** All page views from smart_ga4_page_data for each report_date in range. */
export async function sumPageTableViewsByDate(supabase, clientId, days, opts = {}) {
  return sumViewsByDays(supabase, clientId, days, PAGE_TABLE, opts);
}

/** VDP views from smart_final_data for each report_date in range. */
export async function sumFinalTableViewsByDate(supabase, clientId, days) {
  return sumViewsByDays(supabase, clientId, days, FINAL_TABLE, {});
}

/**
 * Hoot URL match split by vdp_conditions (views) per report_date.
 * Prefers smart_final_data; falls back to VDP rows in smart_ga4_page_data.
 */
async function sumHootMatchForSingleDay(supabase, clientId, day, table) {
  let matched = 0;
  let nonMatched = 0;
  let offset = 0;
  const filterVdpOnly = table === PAGE_TABLE;

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select('views, vdp_conditions, ga4_page_type')
      .eq('client_id', clientId)
      .eq('report_date', day)
      .order('page_path', { ascending: true })
      .range(offset, offset + FETCH_SIZE - 1);

    if (error) throw new Error(error.message);
    if (!data?.length) break;

    for (const row of data) {
      if (filterVdpOnly && !isVdpPageRow(row)) continue;
      const views = Number(row.views) || 0;
      if (views === 0) continue;
      if (row.vdp_conditions === true) matched += views;
      else nonMatched += views;
    }

    if (data.length < FETCH_SIZE) break;
    offset += FETCH_SIZE;
  }

  return { matched, nonMatched };
}

export async function sumHootUrlMatchByDate(supabase, clientId, days) {
  const daily = {};
  if (!clientId || !days?.length) return daily;

  await mapPool(days, DAY_CONCURRENCY, async (day) => {
    let { matched, nonMatched } = await sumHootMatchForSingleDay(
      supabase,
      clientId,
      day,
      FINAL_TABLE
    );

    if (matched === 0 && nonMatched === 0) {
      ({ matched, nonMatched } = await sumHootMatchForSingleDay(
        supabase,
        clientId,
        day,
        PAGE_TABLE
      ));
    }

    if (matched > 0 || nonMatched > 0) {
      daily[day] = { matched, nonMatched };
    }
  });

  return daily;
}

export async function countPageRowsInRange(
  supabase,
  clientId,
  from,
  to,
  { vdpOnly = false } = {}
) {
  let query = supabase
    .from(PAGE_TABLE)
    .select('*', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .gte('report_date', from)
    .lte('report_date', to);

  if (vdpOnly) query = query.eq('vdp_conditions', true);

  const { count, error } = await query;
  if (error) return { count: 0, error: error.message };
  return { count: count ?? 0 };
}

export async function countVdpPageRowsAny(supabase, clientId) {
  const { count, error } = await supabase
    .from(PAGE_TABLE)
    .select('*', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('vdp_conditions', true);

  if (error) return { count: 0, error: error.message };
  return { count: count ?? 0 };
}
