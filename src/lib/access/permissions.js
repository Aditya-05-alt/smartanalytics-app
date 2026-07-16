export const REPORT_OPTIONS = [
  { key: 'overview', label: 'Overview', href: '/dashboard' },
  { key: 'inventory', label: 'Inventory report', href: '/dashboard/inventory' },
  { key: 'health', label: 'Portfolio Health', href: '/dashboard/health' },
  { key: 'attribution', label: 'Attribution', href: '/dashboard/attribution' },
  { key: 'local', label: 'Local Intel', href: '/dashboard/local' },
];

export const DEFAULT_ACCESS = Object.freeze({
  role: 'admin',
  allReports: true,
  reportKeys: REPORT_OPTIONS.map((report) => report.key),
  allDealers: true,
  dealerIds: [],
});

const VALID_REPORT_KEYS = new Set(REPORT_OPTIONS.map((report) => report.key));

export function normalizeAccess(row) {
  if (!row || row.role !== 'user') return { ...DEFAULT_ACCESS };

  return {
    role: 'user',
    allReports: row.all_reports === true,
    reportKeys: (row.report_keys || []).filter((key) => VALID_REPORT_KEYS.has(key)),
    allDealers: row.all_dealers === true,
    dealerIds: (row.dealer_ids || [])
      .map(Number)
      .filter((id) => Number.isInteger(id) && id > 0),
  };
}

export function canAccessReport(access, key) {
  if (!access || access.role === 'admin' || access.allReports) return true;
  return access.reportKeys.includes(key);
}

export function reportKeyFromPathname(pathname) {
  if (pathname === '/dashboard' || pathname === '/dashboard/') return 'overview';
  const match = REPORT_OPTIONS.find(
    (report) => report.href !== '/dashboard' && pathname?.startsWith(report.href)
  );
  return match?.key || null;
}

export function firstAllowedReportHref(access) {
  return (
    REPORT_OPTIONS.find((report) => canAccessReport(access, report.key))?.href ||
    '/login'
  );
}
