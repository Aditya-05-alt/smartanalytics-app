import { ALL_DEALER_CLIENT, ALL_DEALER_ID } from '@/lib/dashboard/allDealers';

const DEALER_ID_KEY = 'sa_selected_dealer_id';
const LAST_REAL_DEALER_ID_KEY = 'sa_last_real_dealer_id';
const OVERVIEW_TAB_KEY = 'sa_overview_tab';
const OVERVIEW_DATE_RANGE_KEY = 'sa_overview_date_range';
const OVERVIEW_COMPARE_ENABLED_KEY = 'sa_overview_compare_enabled';
const OVERVIEW_COMPARE_DATE_RANGE_KEY = 'sa_overview_compare_date_range';
const ADMIN_DEALER_ID_KEY = 'sa_admin_pipeline_dealer_id';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoDate(value) {
  return typeof value === 'string' && ISO_DATE_RE.test(value);
}

function parseStoredRangeObject(raw) {
  if (!raw?.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!isValidIsoDate(parsed?.start) || !isValidIsoDate(parsed?.end)) {
      return null;
    }
    return {
      start: parsed.start,
      end: parsed.end,
      preset: parsed.preset || 'custom',
    };
  } catch {
    return null;
  }
}

export const OVERVIEW_TAB_IDS = ['vdp', 'srp', 'home', 'all', 'other'];

function canUseStorage() {
  return typeof window !== 'undefined';
}

export function readStoredDealerId() {
  if (!canUseStorage()) return null;
  try {
    const raw = localStorage.getItem(DEALER_ID_KEY);
    return raw ? String(raw) : null;
  } catch {
    return null;
  }
}

export function writeStoredDealerId(id) {
  if (!canUseStorage() || id == null) return;
  try {
    localStorage.setItem(DEALER_ID_KEY, String(id));
  } catch {
    /* ignore */
  }
}

/** Reset picker to All Dealer (call on logout and login page). */
export function resetDealerToAll() {
  if (!canUseStorage()) return;
  try {
    localStorage.removeItem(LAST_REAL_DEALER_ID_KEY);
    localStorage.setItem(DEALER_ID_KEY, ALL_DEALER_ID);
  } catch {
    /* ignore */
  }
}

export function readStoredOverviewTab() {
  if (!canUseStorage()) return null;
  try {
    const tab = localStorage.getItem(OVERVIEW_TAB_KEY);
    return OVERVIEW_TAB_IDS.includes(tab) ? tab : null;
  } catch {
    return null;
  }
}

export function writeStoredOverviewTab(tab) {
  if (!canUseStorage() || !OVERVIEW_TAB_IDS.includes(tab)) return;
  try {
    localStorage.setItem(OVERVIEW_TAB_KEY, tab);
  } catch {
    /* ignore */
  }
}

/** Last overview date range — preset id string or { start, end, preset }. */
export function readStoredOverviewDateRange() {
  if (!canUseStorage()) return null;
  try {
    const raw = localStorage.getItem(OVERVIEW_DATE_RANGE_KEY);
    if (!raw) return null;
    const asObject = parseStoredRangeObject(raw);
    if (asObject) return asObject;
    return raw;
  } catch {
    return null;
  }
}

export function writeStoredOverviewDateRange(value) {
  if (!canUseStorage() || value == null) return;
  try {
    if (typeof value === 'string') {
      localStorage.setItem(OVERVIEW_DATE_RANGE_KEY, value);
      return;
    }
    if (typeof value === 'object' && isValidIsoDate(value.start) && isValidIsoDate(value.end)) {
      localStorage.setItem(
        OVERVIEW_DATE_RANGE_KEY,
        JSON.stringify({
          start: value.start,
          end: value.end,
          preset: value.preset || 'custom',
        }),
      );
    }
  } catch {
    /* ignore */
  }
}

export function readStoredOverviewCompareEnabled() {
  if (!canUseStorage()) return false;
  try {
    return localStorage.getItem(OVERVIEW_COMPARE_ENABLED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function writeStoredOverviewCompareEnabled(enabled) {
  if (!canUseStorage()) return;
  try {
    localStorage.setItem(OVERVIEW_COMPARE_ENABLED_KEY, enabled ? 'true' : 'false');
  } catch {
    /* ignore */
  }
}

export function readStoredOverviewCompareDateRange() {
  if (!canUseStorage()) return null;
  try {
    const raw = localStorage.getItem(OVERVIEW_COMPARE_DATE_RANGE_KEY);
    if (!raw) return null;
    return parseStoredRangeObject(raw);
  } catch {
    return null;
  }
}

export function writeStoredOverviewCompareDateRange(value) {
  if (!canUseStorage()) return;
  try {
    if (value == null) {
      localStorage.removeItem(OVERVIEW_COMPARE_DATE_RANGE_KEY);
      return;
    }
    if (typeof value === 'object' && isValidIsoDate(value.start) && isValidIsoDate(value.end)) {
      localStorage.setItem(
        OVERVIEW_COMPARE_DATE_RANGE_KEY,
        JSON.stringify({
          start: value.start,
          end: value.end,
          preset: value.preset || 'custom',
        }),
      );
    }
  } catch {
    /* ignore */
  }
}

export function readStoredAdminDealerId() {
  if (!canUseStorage()) return null;
  try {
    const raw = localStorage.getItem(ADMIN_DEALER_ID_KEY);
    return raw ? String(raw) : null;
  } catch {
    return null;
  }
}

export function writeStoredAdminDealerId(id) {
  if (!canUseStorage() || !id) return;
  try {
    localStorage.setItem(ADMIN_DEALER_ID_KEY, String(id));
  } catch {
    /* ignore */
  }
}

function findDealerById(dealers, id) {
  if (!id || !dealers?.length) return null;
  return dealers.find((d) => String(d.id) === String(id)) || null;
}

export function resolveDealerFromList(dealers, storedId) {
  if (!dealers?.length) return ALL_DEALER_CLIENT;

  if (storedId === ALL_DEALER_ID) return ALL_DEALER_CLIENT;

  const storedMatch = findDealerById(dealers, storedId);
  if (storedMatch) return storedMatch;

  return ALL_DEALER_CLIENT;
}
