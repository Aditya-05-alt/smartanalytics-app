import { dayCountInclusive } from '@/lib/ga4/dateRange';

/**
 * GA4 daily summary pilot — dealers whose overview / channel breakdown are read
 * from smart_sum_* tables instead of scanning smart_ga4_page_data.
 * Dealers not listed here never touch the summary path.
 */

export const GA4_SUMMARY_PILOT_CLIENT_IDS = new Set([
  '2728830488', // A&L RV Sales
  '1162028739', // Gerzeny's RV
  '6999622645', // Chesaco RV
  '5691491478', // Zoomers RV
  '4668711550', // Trailer Source Inc
  '6250904299', // United Motorsports & RV
  '9842851162', // Sky River RV
  '9080903239', // Southland RV
  '8841710958', // Johnston RV
  '260260849', // Toppers RV
  '5281027171', // FIFE RV Center
  '2562396503', // Ricks RV
  '3759117472', // Clearcreek RVs TX
  '2721177227', // Peak Honda World
  '2360685226', // Coastal RV
  '5152307309', // Happy Camper RV
  '5592824688', // Pierce RV Great Falls
]);

/** Days not yet summarised (live / re-synced) are read raw; above this, use the old path. */
const MAX_UNCOVERED_DAYS = 7;

export function isGa4SummaryPilot(clientId) {
  return GA4_SUMMARY_PILOT_CLIENT_IDS.has(String(clientId || '').trim());
}

export async function canUseGa4Summary(supabase, clientId, from, to) {
  if (!isGa4SummaryPilot(clientId)) return false;
  const { data, error } = await supabase.rpc('get_ga4_summary_coverage', {
    p_client_id: String(clientId).trim(),
    p_from: from,
    p_to: to,
  });
  if (error || !data?.enabled) return false;
  return Number(data.uncovered_days) <= MAX_UNCOVERED_DAYS;
}

/** Per-page VDP summary rows cover the range (channel / inventory filters can skip raw GA4). */
export async function canUseGa4VdpPaths(supabase, clientId, from, to) {
  if (!isGa4SummaryPilot(clientId)) return false;
  const { data, error } = await supabase.rpc('ga4_vdp_path_usable', {
    p_client_id: String(clientId).trim(),
    p_from: from,
    p_to: to,
  });
  return !error && data === true;
}

export function singleCallPlan(from, to) {
  return { chunkDays: Math.max(dayCountInclusive(from, to), 1), concurrency: 1 };
}

/**
 * Inventory breakdowns for pilot dealers run as one call: their VDP total comes from
 * the summary, and channel filters read the per-page summary rows when they cover the range.
 */
export async function pilotBreakdownChunkPlan(supabase, clientId, from, to, plan, channels) {
  if (!isGa4SummaryPilot(clientId)) return plan;
  if (!channels?.length) return singleCallPlan(from, to);
  return (await canUseGa4VdpPaths(supabase, clientId, from, to)) ? singleCallPlan(from, to) : plan;
}

export function inventoryFiltersActive(inv = {}) {
  return Boolean(
    inv.p_years?.length ||
      inv.p_makes?.length ||
      inv.p_models?.length ||
      inv.p_types?.length ||
      inv.p_locations?.length ||
      (inv.p_condition && inv.p_condition !== 'BOTH')
  );
}
