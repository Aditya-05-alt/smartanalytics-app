/**
 * Inventory report — standalone module (not part of VDP Step 3 / smart_final_data).
 */

import { fetchGetInventoryReport } from '@/lib/api/inventoryReportApi';
import { createClient } from '@/lib/supabase/client';
import { isAllDealerClient } from '@/lib/dashboard/allDealers';
import { getDummyInventoryReport } from './inventoryReportDummy';
import { normalizeInventoryFilters } from './inventoryReportFilters';
import { normalizeInventoryReportResponse } from './inventoryReportNormalize';

export const INVENTORY_REPORT_PATH = '/dashboard/inventory';

/** Inventory report requires a single dealer; no portfolio-wide "All Dealers" mode. */
export const INVENTORY_REPORT_INCLUDES_ALL_DEALERS = false;

export function inventoryReportExcludesAllDealers() {
  return !INVENTORY_REPORT_INCLUDES_ALL_DEALERS;
}

export function isInventoryReportPath(pathname) {
  return Boolean(pathname?.startsWith(INVENTORY_REPORT_PATH));
}

/** Pick a concrete dealer when All Dealers is not allowed. */
export function resolveInventoryReportClient(client, dealers = []) {
  if (!inventoryReportExcludesAllDealers()) return client;
  if (isAllDealerClient(client)) {
    return dealers.find((d) => !isAllDealerClient(d)) ?? null;
  }
  return client;
}

export function resolveInventoryReportClientId(client, dealers = []) {
  const resolved = resolveInventoryReportClient(client, dealers);
  return resolved?.ga4CustomerId || resolved?.id || null;
}

export const INVENTORY_REPORT_SECTION_ORDER = [
  'condition',
  'location',
  'make',
  'type',
];

const EMPTY_LIST = {
  rows: [],
  totalUnits: 0,
  totalValue: 0,
  averagePrice: 0,
};

/**
 * @param {{
 *   clientId?: string,
 *   reportDate?: string,
 *   filters?: object,
 * }} params
 */
export async function fetchInventoryReport(params = {}) {
  const normalizedFilters = normalizeInventoryFilters(params.filters);
  const clientId = params.clientId ? String(params.clientId).trim() : null;

  const supabase = createClient();
  if (!supabase) {
    const sample = getDummyInventoryReport();
    return {
      ...sample,
      filterOptions: null,
      meta: {
        clientId,
        reportDate: params.reportDate ?? null,
        pullDate: null,
        filters: normalizedFilters,
        source: 'sample',
        allDealers: false,
      },
    };
  }

  const raw = await fetchGetInventoryReport({
    clientId,
    reportDate: params.reportDate,
    filters: normalizedFilters,
  });

  return normalizeInventoryReportResponse(raw, {
    clientId,
    reportDate: params.reportDate,
    filters: normalizedFilters,
  });
}

export { EMPTY_LIST };
