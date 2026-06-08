'use client';

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { fetchOverviewBundle } from '@/lib/api/overviewFetch';
import { fetchVdpDailyFiltered, fetchVdpFilterOptions } from '@/lib/api/dashboardApi';
import {
  DEFAULT_VDP_FILTERS,
  vdpFiltersActive,
  normalizeVdpFilters,
} from '@/lib/vdp/vdpFilterParams';
import {
  getOverviewCache,
  setOverviewCache,
} from '@/lib/data/overviewCache';
import { normalizeReportDate } from '@/lib/ga4/aggregatePageDataRows';
import { enumerateDatesInclusive, toCalendarISO } from '@/lib/ga4/dateRange';
import { useClient } from '../ClientContext';

const OverviewDataContext = createContext(null);

const EMPTY_VDP_FILTER_OPTIONS = {
  years: ['All'],
  makes: ['All'],
  models: ['All'],
  locations: ['All'],
  types: ['All'],
};

function pruneInvalidFilterSelections(filters, options) {
  const next = { ...filters };
  const keys = ['year', 'make', 'model', 'type', 'location'];
  for (const key of keys) {
    const list = options[`${key}s`] || options[key] || ['All'];
    if (next[key] !== 'All' && !list.includes(next[key])) {
      next[key] = 'All';
    }
  }
  return next;
}
const TAB_IDS = ['all', 'vdp', 'srp', 'home', 'other'];
const DEFAULT_RANGE = 'current_month';

function daysAgo(base, n) {
  const d = new Date(base);
  d.setDate(d.getDate() - n);
  return d;
}

/** Resolve the DateRange value into ISO date strings (inclusive). */
function resolveRange(value) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Any object that carries an explicit start/end wins — whatever the picker emits.
  if (value && typeof value === 'object' && value.start && value.end) {
    return { from: value.start, to: value.end };
  }

  const v = typeof value === 'string' ? value : DEFAULT_RANGE;
  let from = today;
  let to = today;

  switch (v) {
    case 'today':
      break;
    case 'yesterday':
      from = daysAgo(today, 1);
      to = daysAgo(today, 1);
      break;
    case '7d':
      from = daysAgo(today, 6);
      break;
    case '14d':
      from = daysAgo(today, 13);
      break;
    case '30d':
      from = daysAgo(today, 29);
      break;
    case '90d':
      from = daysAgo(today, 89);
      break;
    case '12m':
      from = daysAgo(today, 364);
      break;
    case 'current_month':
    case 'mtd':
      from = new Date(today.getFullYear(), today.getMonth(), 1);
      break;
    case 'last_mtd': {
      const end = new Date(today.getFullYear(), today.getMonth(), 0);
      from = new Date(end.getFullYear(), end.getMonth(), 1);
      to = end;
      break;
    }
    case 'qtd': {
      const q = Math.floor(today.getMonth() / 3);
      from = new Date(today.getFullYear(), q * 3, 1);
      break;
    }
    case 'ytd':
      from = new Date(today.getFullYear(), 0, 1);
      break;
    case 'last_year': {
      const y = today.getFullYear() - 1;
      from = new Date(y, 0, 1);
      to = new Date(y, 11, 31);
      break;
    }
    case 'all':
      from = new Date(2020, 0, 1);
      break;
    default:
      if (typeof v === 'string' && /^year_\d{4}$/.test(v)) {
        const y = Number(v.slice(5));
        from = new Date(y, 0, 1);
        to = y === today.getFullYear() ? today : new Date(y, 11, 31);
      } else {
        from = daysAgo(today, 29);
      }
  }

  return { from: toCalendarISO(from), to: toCalendarISO(to) };
}

/** Normalize `ga4_page_type` from Supabase to our tab id.
 *  Tolerant of spaces, dashes, underscores and casing — so
 *  "Home page", "home_page", "HOME-PAGE", "homepage" all map to `home`.
 */
function pageTypeToTab(raw) {
  const t = String(raw || '').toLowerCase().replace(/[\s_\-]+/g, '');
  if (t === 'srp' || t === 'searchresults' || t === 'searchresultspage') return 'srp';
  if (t === 'home' || t === 'homepage') return 'home';
  if (t === 'vdp' || t === 'vehicledetails' || t === 'vehicledetailspage') return 'vdp';
  return 'other';
}

/** Drop trailing chart days with no views on any tab (e.g. today before pipeline runs). */
function chartDateListAndSeries(dateList, seriesByTab) {
  if (!dateList.length) return { dateList, seriesByTab };

  let end = dateList.length;
  while (end > 1) {
    const idx = end - 1;
    const hasViews = TAB_IDS.some((key) => (seriesByTab[key]?.[idx] || 0) > 0);
    if (hasViews) break;
    end -= 1;
  }

  if (end === dateList.length) return { dateList, seriesByTab };

  const trimmedDates = dateList.slice(0, end);
  const trimmedSeries = {};
  for (const key of TAB_IDS) {
    trimmedSeries[key] = (seriesByTab[key] || []).slice(0, end);
  }
  return { dateList: trimmedDates, seriesByTab: trimmedSeries };
}

export function OverviewProvider({ children }) {
  const { client } = useClient();

  const [tab, setTab] = useState('all');
  const [dateRange, setDateRange] = useState(DEFAULT_RANGE);
  const [vdpFilters, setVdpFilters] = useState(DEFAULT_VDP_FILTERS);
  const [vdpFilterOptions, setVdpFilterOptions] = useState(EMPTY_VDP_FILTER_OPTIONS);
  const [vdpFilteredDaily, setVdpFilteredDaily] = useState(null);
  const [vdpFiltersLoading, setVdpFiltersLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [userTotalsRows, setUserTotalsRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const { from, to } = useMemo(() => resolveRange(dateRange), [dateRange]);

  // ── single fetch keyed by (client, from, to) ─────────────────
  // Join: `smart_ga4_page_data.client_id` === `smart_hoot_config.ga4_customer_id`.
  const clientKey = client?.ga4CustomerId || null;

  const setVdpFilter = useCallback((key, value) => {
    setVdpFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  useEffect(() => {
    setVdpFilters(DEFAULT_VDP_FILTERS);
  }, [clientKey, from, to]);

  useEffect(() => {
    if (!clientKey || !from || !to) {
      setRows([]);
      return undefined;
    }

    let cancelled = false;
    const cached = getOverviewCache(clientKey, from, to);
    if (cached) {
      setRows(cached.rows || []);
      setUserTotalsRows(cached.userTotalsRows || []);
      setLoading(false);
      setError(null);
    } else {
      setRows([]);
      setUserTotalsRows([]);
      setLoading(true);
      setError(null);
    }

    (async () => {
      try {
        const bundle = await fetchOverviewBundle({
          clientId: clientKey,
          from,
          to,
          onCancelCheck: () => cancelled,
        });
        if (cancelled || !bundle) return;

        setRows(bundle.rows || []);
        setUserTotalsRows(bundle.userTotalsRows || []);
        setOverviewCache(clientKey, from, to, {
          rows: bundle.rows || [],
          userTotalsRows: bundle.userTotalsRows || [],
        });
      } catch (fetchError) {
        if (cancelled) return;
        setError(fetchError?.message || 'Failed to fetch overview data.');
        if (!cached) {
          setRows([]);
          setUserTotalsRows([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clientKey, from, to]);

  // ── VDP filter dropdown options (from inventory in range) ──
  useEffect(() => {
    if (!clientKey || !from || !to) {
      setVdpFilterOptions(EMPTY_VDP_FILTER_OPTIONS);
      return undefined;
    }

    let cancelled = false;
    fetchVdpFilterOptions({
      clientId: clientKey,
      from,
      to,
      onCancelCheck: () => cancelled,
    })
      .then((options) => {
        if (cancelled || !options) return;
        setVdpFilterOptions(options);
        setVdpFilters((current) =>
          pruneInvalidFilterSelections(normalizeVdpFilters(current), options)
        );
      })
      .catch(() => {
        if (!cancelled) setVdpFilterOptions(EMPTY_VDP_FILTER_OPTIONS);
      });

    return () => {
      cancelled = true;
    };
  }, [clientKey, from, to]);

  // ── VDP daily views when any inventory filter is active ──
  useEffect(() => {
    if (!clientKey || !from || !to || !vdpFiltersActive(vdpFilters, 'vdp')) {
      setVdpFilteredDaily(null);
      setVdpFiltersLoading(false);
      return undefined;
    }

    let cancelled = false;
    setVdpFiltersLoading(true);

    fetchVdpDailyFiltered({
      clientId: clientKey,
      from,
      to,
      vdpFilters,
      tab: 'vdp',
      onCancelCheck: () => cancelled,
    })
      .then((result) => {
        if (!cancelled) setVdpFilteredDaily(result);
      })
      .catch(() => {
        if (!cancelled) setVdpFilteredDaily({ daily: {}, total: 0 });
      })
      .finally(() => {
        if (!cancelled) setVdpFiltersLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [clientKey, from, to, vdpFilters]);

  // ── derived: totals + daily-by-date map per tab + raw page-type histogram ──
  const derived = useMemo(() => {
    const totals = { all: 0, vdp: 0, srp: 0, home: 0, other: 0 };
    const uniqueVisitors = { all: 0, vdp: 0, srp: 0, home: 0, other: 0 };
    const daily = { all: {}, vdp: {}, srp: {}, home: {}, other: {} };
    const pageTypeHist = new Map(); // raw value → { views, rows, tab }

    for (const r of rows) {
      const views = Number(r.views) || 0;
      const visitors = Number(r.total_users) || 0;
      const date = normalizeReportDate(r.report_date);
      if (!date) continue;
      const rawType = r.ga4_page_type ?? '(null)';
      const tabKey = pageTypeToTab(r.ga4_page_type);

      // histogram (always count the row, even if views=0)
      const prev = pageTypeHist.get(rawType) || { views: 0, rows: 0, tab: tabKey };
      prev.views += views;
      prev.rows += 1;
      prev.tab = tabKey;
      pageTypeHist.set(rawType, prev);

      uniqueVisitors.all += visitors;
      if (tabKey !== 'vdp') {
        uniqueVisitors[tabKey] += visitors;
      }

      if (views === 0) continue;

      // "all" sums every row
      totals.all += views;
      daily.all[date] = (daily.all[date] || 0) + views;

      totals[tabKey] += views;
      daily[tabKey][date] = (daily[tabKey][date] || 0) + views;
    }

    const pageTypes = Array.from(pageTypeHist.entries())
      .map(([raw, info]) => ({ raw, ...info }))
      .sort((a, b) => b.views - a.views);

    // IMPORTANT:
    // User/session metrics are sourced from smart_ga4_data via RPC
    // and are not split by ga4_page_type in this context.
    const totalUsers = userTotalsRows.reduce(
      (sum, r) => sum + (Number(r.total_users) || 0),
      0
    );
    uniqueVisitors.all = totalUsers;
    uniqueVisitors.vdp = totalUsers;
    uniqueVisitors.srp = totalUsers;
    uniqueVisitors.home = totalUsers;
    uniqueVisitors.other = totalUsers;

    return { totals, uniqueVisitors, daily, pageTypes };
  }, [rows, userTotalsRows]);

  const adjustedDerived = useMemo(() => {
    if (!vdpFiltersActive(vdpFilters, 'vdp') || !vdpFilteredDaily) return derived;
    return {
      ...derived,
      totals: { ...derived.totals, vdp: vdpFilteredDaily.total || 0 },
      daily: { ...derived.daily, vdp: vdpFilteredDaily.daily || {} },
    };
  }, [derived, vdpFilters, vdpFilteredDaily]);

  // ── derived: continuous daily series (zero-fills missing days) ──
  const fullDateList = useMemo(
    () => enumerateDatesInclusive(from, to),
    [from, to]
  );

  const seriesByTabRaw = useMemo(() => {
    const out = {};
    for (const key of TAB_IDS) {
      out[key] = fullDateList.map((d) => adjustedDerived.daily[key]?.[d] || 0);
    }
    return out;
  }, [adjustedDerived, fullDateList]);

  const { dateList, seriesByTab } = useMemo(
    () => chartDateListAndSeries(fullDateList, seriesByTabRaw),
    [fullDateList, seriesByTabRaw]
  );

  const rowCount = rows.length;

  const value = useMemo(
    () => ({
      tab,
      setTab,
      dateRange,
      setDateRange,
      vdpFilters,
      setVdpFilter,
      vdpFilterOptions,
      vdpFiltersLoading,
      from,
      to,
      dateList,
      totals: adjustedDerived.totals,
      uniqueVisitors: derived.uniqueVisitors,
      pageTypes: derived.pageTypes,
      seriesByTab,
      loading: loading || (tab === 'vdp' && vdpFiltersActive(vdpFilters, 'vdp') && vdpFiltersLoading),
      error,
      rowCount,
      clientKey,
      rows,
    }),
    [
      tab,
      dateRange,
      vdpFilters,
      setVdpFilter,
      vdpFilterOptions,
      vdpFiltersLoading,
      from,
      to,
      dateList,
      adjustedDerived.totals,
      derived.uniqueVisitors,
      derived.pageTypes,
      seriesByTab,
      loading,
      vdpFiltersLoading,
      error,
      rowCount,
      clientKey,
      rows,
    ]
  );

  return (
    <OverviewDataContext.Provider value={value}>
      {children}
    </OverviewDataContext.Provider>
  );
}

export function useOverview() {
  const ctx = useContext(OverviewDataContext);
  if (!ctx) {
    throw new Error('useOverview must be used inside <OverviewProvider>');
  }
  return ctx;
}
