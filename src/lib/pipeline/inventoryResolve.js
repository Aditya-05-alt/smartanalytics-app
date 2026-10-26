import { isScrapLinkOn } from '@/lib/vdpLogics/scrapStatus';

export const FINAL_RPC_HOOT = 'build_smart_final_data';
/** Destination Cycle / page_path_q_s dealers only — uses ga4_effective_page_path. */
export const FINAL_RPC_HOOT_QS = 'build_smart_final_data_qs';
export const FINAL_RPC_SCRAP = 'build_smart_final_data_scrap';
/** Scout RV / ScoutX VLA feeds — smart_conner_config + smart_conner_inventory. */
export const FINAL_RPC_CONNER = 'build_smart_final_data_conner';

/** Dealers that must use build_smart_final_data_qs (pathname+query matching). */
export const PAGE_PATH_QS_CLIENT_IDS = new Set([
  '1421445735', // Destination Cycle
  '7543766464', // Jay's Power Center — Spike InventoryDetail query VDPs
  '7231326744', // XGRID — VDPs live on default.asp?page=…InventoryDetail
]);

/**
 * GA4 sync stores page_path_q_s for these dealers (Step 2/3 can use query string).
 * Separate from PAGE_PATH_QS_CLIENT_IDS (which forces QS Step 3 RPC).
 */
export const GA4_PAGE_PATH_QS_CLIENT_IDS = new Set([
  '1421445735',
  '7231326744', // XGRID — Dealer Spike default.asp?page=…InventoryDetail
  '7543766464', // Jay's Power Center — Spike InventoryDetail query VDPs
]);

export function resolveHootFinalRpcName(clientId) {
  const id = String(clientId || '').trim();
  return PAGE_PATH_QS_CLIENT_IDS.has(id) ? FINAL_RPC_HOOT_QS : FINAL_RPC_HOOT;
}

export function isPagePathQsClient(clientId) {
  return PAGE_PATH_QS_CLIENT_IDS.has(String(clientId || '').trim());
}

/** Admin UI / API date batch size — QS dealers stay small; others run full range like before. */
export function step3AdminBatchDays(clientId) {
  return isPagePathQsClient(clientId) ? 2 : 366;
}

function hasText(value) {
  return Boolean(String(value ?? '').trim());
}

async function loadVdpLogicRow(supabase, clientId, customerName, ga4PropertyId) {
  const propertyId = ga4PropertyId ? String(ga4PropertyId).trim() : '';

  let byIdQuery = supabase
    .from('smart_vdp_logic')
    .select('hoot_link, scrap_link, data_source')
    .eq('dealer_id', clientId);

  if (propertyId) {
    byIdQuery = byIdQuery.eq('ga4_property_id', propertyId);
  }

  const { data: byId, error: byIdError } = await byIdQuery
    .order('id', { ascending: false })
    .limit(1);

  if (byIdError) {
    throw new Error(byIdError.message);
  }
  if (byId?.[0]) {
    return byId[0];
  }

  if (!customerName) {
    return null;
  }

  let byNameQuery = supabase
    .from('smart_vdp_logic')
    .select('hoot_link, scrap_link, data_source')
    .eq('dealer_name', customerName);

  if (propertyId) {
    byNameQuery = byNameQuery.eq('ga4_property_id', propertyId);
  }

  const { data: byName, error: byNameError } = await byNameQuery
    .order('id', { ascending: false })
    .limit(1);

  if (byNameError) {
    throw new Error(byNameError.message);
  }

  return byName?.[0] ?? null;
}

/** Active smart_conner_config row with a feed URL, plus loaded Conner inventory rows. */
async function loadConnerSource(supabase, clientId) {
  const { data: rows, error } = await supabase
    .from('smart_conner_config')
    .select('customer_name, hoot_url')
    .eq('ga4_customer_id', clientId)
    .eq('is_active', true)
    .not('hoot_url', 'is', null)
    .limit(1);

  if (error) {
    throw new Error(error.message);
  }
  const row = rows?.[0];
  const customerName = row?.customer_name?.trim() || null;
  if (!hasText(row?.hoot_url) || !customerName) {
    return { isConner: false, connerInventoryCount: 0 };
  }

  const { count, error: countError } = await supabase
    .from('smart_conner_inventory')
    .select('*', { count: 'exact', head: true })
    .eq('customer_name', customerName);

  if (countError) {
    throw new Error(countError.message);
  }
  return { isConner: true, connerInventoryCount: count ?? 0 };
}

/**
 * Pick Step 3 RPC for one dealer.
 *
 * Config tables:
 * - smart_conner_config (hoot_url = Scout RV / ScoutX feed) — Conner dealers
 * - smart_vdp_logic (hoot_link, scrap_link) — Admin → VDP Logics
 * - smart_hoot_config (customer_name, hoot_url, ga4_customer_id)
 * Inventory tables:
 * - smart_conner_inventory (customer_name) — daily Conner feed snapshots
 * - smart_hoot_inventory_live (customer_name) — hoot report pipeline live feed
 * - smart_scrap_inventory (customer_id / customer_name)
 *
 * Priority:
 * 0. active Conner feed → conner RPC (Hoot / Scrap Step 3 skip these dealers)
 * 0b. data_source = Logic → hoot RPC with no inventory (unmatched rows); Step 4 /
 *     Logic 2 cleanup fills make / model / year / condition from the page path
 * 1. hoot_link set → hoot RPC
 * 2. scrap_link OR scrap inventory rows → scrap RPC (even if stale hoot_url / hoot rows exist)
 * 3. hoot_url OR hoot inventory rows → hoot RPC
 * 4. default → scrap RPC
 */
export async function resolveFinalVdpRpc(supabase, clientId) {
  const trimmedId = String(clientId || '').trim();
  if (!trimmedId) {
    throw new Error('Missing clientId for inventory resolution.');
  }

  const { data: configRows, error: configError } = await supabase
    .from('smart_hoot_config')
    .select('customer_name, hoot_url, ga4_property_id')
    .eq('ga4_customer_id', trimmedId)
    .eq('is_active', true)
    .limit(1);

  if (configError) {
    throw new Error(configError.message);
  }

  const customerName = configRows?.[0]?.customer_name?.trim() || null;
  const hootUrl = configRows?.[0]?.hoot_url?.trim() || null;
  const ga4PropertyId = configRows?.[0]?.ga4_property_id?.trim() || null;
  const vdpLogic = await loadVdpLogicRow(
    supabase,
    trimmedId,
    customerName,
    ga4PropertyId
  );

  const hasHootLink = hasText(vdpLogic?.hoot_link);
  const hasHootUrl = hasText(hootUrl);

  let hootInventoryCount = 0;
  if (customerName) {
    // Case-insensitive: e.g. "Moix Rv" config ↔ "Moix RV" Hoot inventory
    const { count, error } = await supabase
      .from('smart_hoot_inventory_live')
      .select('*', { count: 'exact', head: true })
      .ilike('customer_name', customerName);

    if (error) {
      throw new Error(error.message);
    }
    hootInventoryCount = count ?? 0;
  }

  let scrapInventoryCount = 0;
  const { count: scrapByClientId, error: scrapByIdError } = await supabase
    .from('smart_scrap_inventory')
    .select('*', { count: 'exact', head: true })
    .eq('customer_id', trimmedId);

  if (scrapByIdError) {
    throw new Error(scrapByIdError.message);
  }
  scrapInventoryCount = scrapByClientId ?? 0;

  if (scrapInventoryCount === 0 && customerName) {
    const { count: scrapByName, error: scrapByNameError } = await supabase
      .from('smart_scrap_inventory')
      .select('*', { count: 'exact', head: true })
      .ilike('customer_name', customerName);

    if (scrapByNameError) {
      throw new Error(scrapByNameError.message);
    }
    scrapInventoryCount = scrapByName ?? 0;
  }

  const hasScrapInventory = scrapInventoryCount > 0;
  const hasHootInventory = hootInventoryCount > 0;
  const hasScrapLink = isScrapLinkOn(vdpLogic?.scrap_link, scrapInventoryCount);
  const hasScrapSource = hasScrapLink || hasScrapInventory;

  let useHoot;
  let step3Reason;

  if (hasHootLink) {
    useHoot = true;
    step3Reason = 'hoot_link in smart_vdp_logic';
  } else if (hasScrapSource) {
    useHoot = false;
    step3Reason = hasScrapLink
      ? vdpLogic?.scrap_link?.trim().toLowerCase() === 'on'
        ? 'scrap_link on in smart_vdp_logic'
        : 'scrap enabled in smart_vdp_logic'
      : `smart_scrap_inventory (${scrapInventoryCount.toLocaleString()} rows)`;
  } else if (hasHootUrl || hasHootInventory) {
    useHoot = true;
    step3Reason = hasHootUrl
      ? 'hoot_url on smart_hoot_config'
      : `smart_hoot_inventory_live (${hootInventoryCount.toLocaleString()} rows)`;
  } else {
    useHoot = false;
    step3Reason = 'no hoot source configured';
  }

  const { isConner, connerInventoryCount } = await loadConnerSource(supabase, trimmedId);

  if (isConner) {
    return {
      rpcName: FINAL_RPC_CONNER,
      inventorySource: 'conner',
      step3Reason: `Conner feed on smart_conner_config (${connerInventoryCount.toLocaleString()} inventory rows)`,
      customerName,
      hasConnerSource: true,
      connerInventoryCount,
      hasHootLink,
      hasScrapLink,
      hasHootUrl,
      hasHootSource: false,
      hasScrapSource: false,
      hasScrapInventory,
      hasHootInventory,
      hootInventoryCount,
      scrapInventoryCount,
    };
  }

  if (String(vdpLogic?.data_source ?? '').trim().toLowerCase() === 'logic') {
    return {
      rpcName: resolveHootFinalRpcName(trimmedId),
      inventorySource: 'logic',
      step3Reason:
        'Logic only (Step 4) — no inventory feed; Logic 2 fills make / model / year from the page path',
      customerName,
      hasConnerSource: false,
      connerInventoryCount: 0,
      hasHootLink,
      hasScrapLink,
      hasHootUrl,
      hasHootSource: false,
      hasScrapSource: false,
      hasScrapInventory,
      hasHootInventory,
      hootInventoryCount,
      scrapInventoryCount,
    };
  }

  return {
    rpcName: useHoot ? resolveHootFinalRpcName(trimmedId) : FINAL_RPC_SCRAP,
    inventorySource: useHoot ? 'hoot' : 'scrap',
    step3Reason: useHoot
      ? PAGE_PATH_QS_CLIENT_IDS.has(trimmedId)
        ? `${step3Reason} · page_path_q_s RPC`
        : step3Reason
      : step3Reason,
    customerName,
    hasConnerSource: false,
    connerInventoryCount: 0,
    hasHootLink,
    hasScrapLink,
    hasHootUrl,
    hasHootSource: useHoot,
    hasScrapSource,
    hasScrapInventory,
    hasHootInventory,
    hootInventoryCount,
    scrapInventoryCount,
  };
}
