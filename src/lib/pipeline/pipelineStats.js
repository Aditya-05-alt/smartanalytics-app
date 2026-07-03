import { coerceDateRange, STATS_VIEWS_CHUNK_SIZE } from '@/lib/pipeline/dates';
import {
  countPageRowsInRange,
  countVdpPageRowsAny,
  sumPipelineRangeViewsByDate,
} from '@/lib/pipeline/pageViewsStats';

const PAGE_TABLE = 'smart_ga4_page_data';
const FINAL_TABLE = 'smart_final_data';
const FETCH_SIZE = 1000;
export const MAX_RANGE_DAYS = 90;
export const MAX_VIEWS_CHUNK_DAYS = STATS_VIEWS_CHUNK_SIZE;

async function countInRange(supabase, table, clientId, from, to) {
  const { count, error } = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .gte('report_date', from)
    .lte('report_date', to);

  if (error) return { count: 0, error: error.message };
  return { count: count ?? 0 };
}

async function fetchDealerInventoryContext(supabase, clientId) {
  const { data: hootRow, error: hootErr } = await supabase
    .from('smart_hoot_config')
    .select('customer_name')
    .eq('ga4_customer_id', clientId)
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (hootErr) {
    return { customerName: null, error: hootErr.message };
  }

  const customerName = hootRow?.customer_name?.trim() || null;

  const [hootInv, scrapInv, vdpLogic] = await Promise.all([
    customerName
      ? supabase
          .from('smart_hoot_inventory')
          .select('*', { count: 'exact', head: true })
          .eq('customer_name', customerName)
      : Promise.resolve({ count: 0, error: null }),
    supabase
      .from('smart_scrap_inventory')
      .select('*', { count: 'exact', head: true })
      .or(
        customerName
          ? `customer_id.eq.${clientId},customer_name.eq.${customerName}`
          : `customer_id.eq.${clientId}`
      ),
    supabase
      .from('smart_vdp_logic')
      .select('scrap_link')
      .or(
        customerName
          ? `dealer_id.eq.${clientId},dealer_name.eq.${customerName}`
          : `dealer_id.eq.${clientId}`
      )
      .not('scrap_link', 'is', null)
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const scrapLink = vdpLogic.data?.scrap_link?.trim() || null;

  return {
    customerName,
    hootInventoryCount: hootInv.error ? 0 : hootInv.count ?? 0,
    scrapInventoryCount: scrapInv.error ? 0 : scrapInv.count ?? 0,
    scrapLink,
    errors: {
      hootInventory: hootInv.error?.message || null,
      scrapInventory: scrapInv.error?.message || null,
    },
  };
}

/** Paginate report_date only — avoids loading full rows into memory. */
export async function filledDatesForTable(supabase, table, clientId, from, to) {
  const filled = new Set();
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select('report_date')
      .eq('client_id', clientId)
      .gte('report_date', from)
      .lte('report_date', to)
      .order('report_date', { ascending: true })
      .range(offset, offset + FETCH_SIZE - 1);

    if (error) return { error: error.message, filled };

    if (!data?.length) break;

    for (const row of data) {
      filled.add(String(row.report_date).split('T')[0]);
    }

    if (data.length < FETCH_SIZE) break;
    offset += FETCH_SIZE;
  }

  return { filled };
}

export function buildRangeViews(
  rangeDays,
  allPageViews,
  vdpPageViews,
  finalViews,
  hootMatch
) {
  const pick = (map) =>
    Object.fromEntries(rangeDays.map((d) => [d, map[d] ?? null]));
  const pickHoot = () =>
    Object.fromEntries(
      rangeDays.map((d) => {
        const v = hootMatch[d];
        if (!v || (v.matched === 0 && v.nonMatched === 0)) return [d, null];
        return [d, v];
      })
    );
  return {
    ga4Page: pick(allPageViews),
    ga4Filter: pick(vdpPageViews),
    finalVdp: pick(finalViews),
    hootMatch: pickHoot(),
  };
}

export function buildWorkflowPayload({
  clientId,
  from,
  to,
  rangeDays,
  pageFill,
  pageCount,
  vdpInRange,
  vdpTotal,
  finalCount,
  inventory,
}) {
  const pageFilled = pageFill.filled || new Set();
  const missingPage = rangeDays.filter((d) => !pageFilled.has(d));

  const hasPageData = (pageCount.count ?? 0) > 0;
  const vdpInRangeCount = vdpInRange.count ?? 0;
  const vdpTotalCount = vdpTotal.count ?? 0;
  const hasFilterData = vdpInRangeCount > 0 || vdpTotalCount > 0;
  const hasFinalData = (finalCount.count ?? 0) > 0;

  const ga4PageComplete =
    rangeDays.length > 0 && missingPage.length === 0 && hasPageData;

  return {
    clientId,
    from,
    to,
    rangeDays,
    dataPresence: {
      ga4Page: hasPageData,
      ga4Filter: hasFilterData,
      finalVdp: hasFinalData,
    },
    coverage: {
      ga4Page: {
        filled: pageFilled.size,
        total: rangeDays.length,
        missingDates: missingPage,
        rowCount: pageCount.count ?? 0,
      },
      ga4Filter: {
        rowCountInRange: vdpInRangeCount,
        rowCountTotal: vdpTotalCount,
        rowCount: vdpInRangeCount,
      },
      finalVdp: {
        rowCount: finalCount.count ?? 0,
      },
      inventory: {
        hootRowCount: inventory?.hootInventoryCount ?? 0,
        scrapRowCount: inventory?.scrapInventoryCount ?? 0,
        scrapLink: inventory?.scrapLink ?? null,
        customerName: inventory?.customerName ?? null,
      },
    },
    workflow: {
      ga4PageComplete,
      hasPageData,
      hasFilterData,
      hasFinalData,
      hasScrapLink: Boolean(inventory?.scrapLink),
      hasHootInventory: (inventory?.hootInventoryCount ?? 0) > 0,
      hasScrapInventory: (inventory?.scrapInventoryCount ?? 0) > 0,
      canRunStep1: Boolean(clientId),
      canRunStep2: hasPageData,
      canRunStep3: hasFilterData,
      canRunScrapSync: Boolean(inventory?.scrapLink),
    },
    errors: {
      pageFill: pageFill.error || null,
      vdpInRange: vdpInRange.error || null,
      vdpTotal: vdpTotal.error || null,
      hootInventory: inventory?.errors?.hootInventory || null,
      scrapInventory: inventory?.errors?.scrapInventory || null,
    },
  };
}

export async function fetchPipelineWorkflowStats(supabase, clientId, fromRaw, toRaw) {
  const { from, to, dates: rangeDays } = coerceDateRange(fromRaw, toRaw);

  if (!rangeDays.length) {
    return { error: 'Invalid date range', status: 400 };
  }

  if (rangeDays.length > MAX_RANGE_DAYS) {
    return {
      error: `Date range is ${rangeDays.length} days. Maximum ${MAX_RANGE_DAYS} days.`,
      status: 400,
    };
  }

  const [pageFill, pageCount, vdpInRange, vdpTotal, finalCount, inventory] =
    await Promise.all([
    filledDatesForTable(supabase, PAGE_TABLE, clientId, from, to),
    countInRange(supabase, PAGE_TABLE, clientId, from, to),
    countPageRowsInRange(supabase, clientId, from, to, { vdpOnly: true }),
    countVdpPageRowsAny(supabase, clientId),
    countInRange(supabase, FINAL_TABLE, clientId, from, to),
    fetchDealerInventoryContext(supabase, clientId),
  ]);

  return {
    status: 200,
    body: buildWorkflowPayload({
      clientId,
      from,
      to,
      rangeDays,
      pageFill,
      pageCount,
      vdpInRange,
      vdpTotal,
      finalCount,
      inventory,
    }),
  };
}

export async function fetchPipelineViewsStats(supabase, clientId, fromRaw, toRaw) {
  const { from, to, dates: rangeDays } = coerceDateRange(fromRaw, toRaw);

  if (!rangeDays.length) {
    return { error: 'Invalid date range', status: 400 };
  }

  if (rangeDays.length > MAX_VIEWS_CHUNK_DAYS) {
    return {
      error: `Views chunk is ${rangeDays.length} days. Maximum ${MAX_VIEWS_CHUNK_DAYS} days per request — load tables in chunks.`,
      status: 400,
    };
  }

  const { allPageViews, vdpPageViews, finalViews, hootMatch } =
    await sumPipelineRangeViewsByDate(supabase, clientId, rangeDays);

  const rangeViews = buildRangeViews(
    rangeDays,
    allPageViews,
    vdpPageViews,
    finalViews,
    hootMatch
  );

  return {
    status: 200,
    body: {
      clientId,
      from,
      to,
      rangeDays,
      rangeViews,
    },
  };
}

export async function fetchPipelineFullStats(supabase, clientId, fromRaw, toRaw) {
  const workflow = await fetchPipelineWorkflowStats(supabase, clientId, fromRaw, toRaw);
  if (workflow.status !== 200) return workflow;

  const { from, to, dates: rangeDays } = coerceDateRange(fromRaw, toRaw);

  const { allPageViews, vdpPageViews, finalViews, hootMatch } =
    await sumPipelineRangeViewsByDate(supabase, clientId, rangeDays);

  const rangeViews = buildRangeViews(
    rangeDays,
    allPageViews,
    vdpPageViews,
    finalViews,
    hootMatch
  );

  return {
    status: 200,
    body: {
      ...workflow.body,
      rangeViews,
    },
  };
}
