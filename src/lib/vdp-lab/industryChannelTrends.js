/**
 * VDP Lab only — industry YoY/MoM channel trends helpers.
 * Does not change Overview / Compare production paths.
 */

import {
  sameMonthLastYearRange,
  previousFullMonthRange,
  periodMonthLabel,
  pctChange,
} from '@/lib/overview/comparePeriod';
import {
  expandChannelsForRpc,
  selectedChannels,
} from '@/lib/vdp/vdpFilterParams';

/** Preferred channel order for the industry trends mockup. */
export const INDUSTRY_TREND_PREFERRED_CHANNELS = [
  'Paid Search',
  'Organic Search',
  'Direct',
  'Cross-network',
  'Email',
];

/**
 * Prior period for lab compare.
 * @param {'yoy'|'mom'} mode
 */
export function industryCompareRanges(from, to, mode = 'yoy') {
  if (mode === 'mom') {
    const { compareFrom, compareTo } = previousFullMonthRange(from, to);
    return {
      mode: 'mom',
      deltaLabel: 'MoM',
      currentFrom: from,
      currentTo: to,
      priorFrom: compareFrom,
      priorTo: compareTo,
      currentLabel: periodMonthLabel(from, to),
      priorLabel: periodMonthLabel(compareFrom, compareTo),
    };
  }

  const { lyFrom, lyTo } = sameMonthLastYearRange(from, to);
  return {
    mode: 'yoy',
    deltaLabel: 'YoY',
    currentFrom: from,
    currentTo: to,
    priorFrom: lyFrom,
    priorTo: lyTo,
    currentLabel: periodMonthLabel(from, to),
    priorLabel: periodMonthLabel(lyFrom, lyTo),
  };
}

/** @deprecated use industryCompareRanges(..., 'yoy') */
export function industryYoyRanges(from, to) {
  return industryCompareRanges(from, to, 'yoy');
}

/**
 * Pick display columns: preferred channels first, then remaining (no cap when
 * maxCols is null/Infinity — used for lab horizontal scroll of all channels).
 */
export function pickIndustryTrendColumns(allColumns, maxCols = 5) {
  const available = (allColumns || []).map(String);
  const availSet = new Set(available);
  const picked = [];
  const limit =
    maxCols == null || maxCols === Infinity ? Number.POSITIVE_INFINITY : maxCols;

  for (const name of INDUSTRY_TREND_PREFERRED_CHANNELS) {
    if (availSet.has(name) && picked.length < limit) {
      picked.push(name);
      availSet.delete(name);
    }
  }

  for (const name of available) {
    if (picked.length >= limit) break;
    if (availSet.has(name)) {
      picked.push(name);
      availSet.delete(name);
    }
  }

  return picked;
}

/** When Channel filter is set, show those channels; otherwise all channels. */
export function pickIndustryTrendColumnsForFilter(allColumns, channelFilter) {
  const selected = selectedChannels(channelFilter);
  if (!selected.length) return pickIndustryTrendColumns(allColumns, Infinity);

  const avail = new Set((allColumns || []).map(String));
  const picked = [];

  for (const label of selected) {
    if (avail.has(label) && !picked.includes(label)) picked.push(label);
  }

  const expanded = expandChannelsForRpc(channelFilter) || [];
  for (const name of expanded) {
    if (avail.has(name) && !picked.includes(name)) picked.push(name);
  }

  return picked.length ? picked : pickIndustryTrendColumns(allColumns, Infinity);
}

export function channelValue(sliceMap, channelName) {
  if (!sliceMap || !channelName) return 0;
  const hit = sliceMap.get(channelName);
  if (hit == null) return 0;
  if (typeof hit === 'number') return Number(hit) || 0;
  return Number(hit.value) || 0;
}

/** Sum selected channel columns (used when Channel filter is active). */
export function sumChannelColumns(sliceMap, columns) {
  let total = 0;
  for (const name of columns || []) {
    total += channelValue(sliceMap, name);
  }
  return total;
}

export function buildPortfolioTotalsRow(rows, columns, portfolioName = 'All RV Dealers') {
  const sliceTotals = new Map();
  let total = 0;
  for (const row of rows || []) {
    total += Number(row.total) || 0;
    for (const slice of row.slices || []) {
      const name = String(slice.name || '');
      if (!name) continue;
      sliceTotals.set(name, (sliceTotals.get(name) || 0) + (Number(slice.value) || 0));
    }
  }
  const slices = (columns || []).map((name) => ({
    name,
    value: sliceTotals.get(name) || 0,
  }));
  return {
    dealer: {
      id: '__portfolio__',
      name: portfolioName,
      ga4CustomerId: '',
    },
    slices,
    total,
    error: null,
    isPortfolio: true,
    dealerCount: (rows || []).length,
  };
}

export { pctChange };
