import { toCalendarISO } from '@/lib/ga4/dateRange';

const INVENTORY_REPORT_DATE_KEY = 'sa_inventory_report_date';
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function defaultInventoryReportDate() {
  return toCalendarISO(new Date());
}

function canUseStorage() {
  return typeof window !== 'undefined';
}

export function readStoredInventoryReportDate() {
  if (!canUseStorage()) return null;
  try {
    const raw = localStorage.getItem(INVENTORY_REPORT_DATE_KEY)?.trim();
    if (!raw || !ISO_DATE_RE.test(raw)) return null;
    return raw;
  } catch {
    return null;
  }
}

export function writeStoredInventoryReportDate(value) {
  if (!canUseStorage() || value == null) return;
  const date = String(value).slice(0, 10);
  if (!ISO_DATE_RE.test(date)) return;
  try {
    localStorage.setItem(INVENTORY_REPORT_DATE_KEY, date);
  } catch {
    /* ignore */
  }
}

export function normalizeInventoryReportDate(value) {
  if (value && ISO_DATE_RE.test(String(value).slice(0, 10))) {
    return String(value).slice(0, 10);
  }
  return defaultInventoryReportDate();
}
