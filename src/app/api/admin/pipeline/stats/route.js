import { NextResponse } from 'next/server';
import { getSuperadminFromCookies } from '@/lib/auth/adminApiAuth';
import { coerceDateRange } from '@/lib/pipeline/dates';
import {
  countPageRowsInRange,
  countVdpPageRowsAny,
  sumFinalTableViewsByDate,
  sumHootUrlMatchByDate,
  sumPageTableViewsByDate,
} from '@/lib/pipeline/pageViewsStats';
import { createAdminDataClient } from '@/lib/supabase/adminDataClient';

const PAGE_TABLE = 'smart_ga4_page_data';
const FINAL_TABLE = 'smart_final_data';
const MAX_RANGE_DAYS = 90;

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

async function filledDatesForTable(supabase, table, clientId, from, to) {
  const { data, error } = await supabase
    .from(table)
    .select('report_date')
    .eq('client_id', clientId)
    .gte('report_date', from)
    .lte('report_date', to);

  if (error) return { error: error.message, filled: new Set() };

  const filled = new Set();
  for (const row of data || []) {
    filled.add(String(row.report_date).split('T')[0]);
  }
  return { filled };
}

function buildRangeViews(
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

export async function GET(request) {
  if (!(await getSuperadminFromCookies())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get('clientId')?.trim();
  const fromRaw = searchParams.get('from');
  const toRaw = searchParams.get('to');

  if (!clientId || !fromRaw || !toRaw) {
    return NextResponse.json({ error: 'Missing clientId, from, or to' }, { status: 400 });
  }

  const { from, to, dates: rangeDays } = coerceDateRange(fromRaw, toRaw);

  if (!rangeDays.length) {
    return NextResponse.json({ error: 'Invalid date range' }, { status: 400 });
  }

  if (rangeDays.length > MAX_RANGE_DAYS) {
    return NextResponse.json(
      {
        error: `Date range is ${rangeDays.length} days. Maximum ${MAX_RANGE_DAYS} days for view tables.`,
      },
      { status: 400 }
    );
  }

  const admin = createAdminDataClient();
  if (!admin) {
    return NextResponse.json({ error: 'Supabase not configured.' }, { status: 503 });
  }

  const { supabase } = admin;

  const [pageFill, pageCount, vdpInRange, vdpTotal, finalCount] = await Promise.all([
    filledDatesForTable(supabase, PAGE_TABLE, clientId, from, to),
    countInRange(supabase, PAGE_TABLE, clientId, from, to),
    countPageRowsInRange(supabase, clientId, from, to, { vdpOnly: true }),
    countVdpPageRowsAny(supabase, clientId),
    countInRange(supabase, FINAL_TABLE, clientId, from, to),
  ]);

  const [allPageViews, vdpPageViews, finalViews, hootMatch] = await Promise.all([
    sumPageTableViewsByDate(supabase, clientId, rangeDays, { vdpOnly: false }),
    sumPageTableViewsByDate(supabase, clientId, rangeDays, { vdpOnly: true }),
    sumFinalTableViewsByDate(supabase, clientId, rangeDays),
    sumHootUrlMatchByDate(supabase, clientId, rangeDays),
  ]);

  const rangeViews = buildRangeViews(
    rangeDays,
    allPageViews,
    vdpPageViews,
    finalViews,
    hootMatch
  );

  const pageFilled = pageFill.filled || new Set();
  const missingPage = rangeDays.filter((d) => !pageFilled.has(d));

  const hasPageData = (pageCount.count ?? 0) > 0;
  const vdpInRangeCount = vdpInRange.count ?? 0;
  const vdpTotalCount = vdpTotal.count ?? 0;
  const hasFilterData = vdpInRangeCount > 0 || vdpTotalCount > 0;
  const hasFinalData = (finalCount.count ?? 0) > 0;

  const ga4PageComplete =
    rangeDays.length > 0 && missingPage.length === 0 && hasPageData;

  return NextResponse.json({
    clientId,
    from,
    to,
    rangeDays,
    rangeViews,
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
    },
    workflow: {
      ga4PageComplete,
      hasPageData,
      hasFilterData,
      hasFinalData,
      canRunStep1: Boolean(clientId),
      canRunStep2: hasPageData,
      canRunStep3: hasFilterData,
    },
    errors: {
      pageFill: pageFill.error || null,
      vdpInRange: vdpInRange.error || null,
      vdpTotal: vdpTotal.error || null,
    },
  });
}
