const DEALER_ID_KEY = 'sa_selected_dealer_id';
const OVERVIEW_TAB_KEY = 'sa_overview_tab';
const ADMIN_DEALER_ID_KEY = 'sa_admin_pipeline_dealer_id';

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

import { ALL_DEALER_CLIENT, ALL_DEALER_ID } from '@/lib/dashboard/allDealers';

export function resolveDealerFromList(dealers, storedId) {
  if (storedId === ALL_DEALER_ID) return ALL_DEALER_CLIENT;
  if (!dealers?.length) return ALL_DEALER_CLIENT;
  if (storedId) {
    const match = dealers.find((d) => String(d.id) === String(storedId));
    if (match) return match;
  }
  return ALL_DEALER_CLIENT;
}
