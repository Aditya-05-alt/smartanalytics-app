export const REPORT_OPTIONS = [
  { key: 'overview', label: 'Overview', href: '/dashboard' },
  { key: 'all-dealers', label: 'All Dealers', href: '/dashboard/all-dealers' },
  { key: 'campaigns', label: 'Campaigns', href: '/dashboard/campaigns' },
  { key: 'compare', label: 'Compare', href: '/dashboard/compare' },
  { key: 'inventory', label: 'Inventory report', href: '/dashboard/inventory' },
  { key: 'traffic', label: 'Traffic', href: '/dashboard/traffic' },
  { key: 'health', label: 'Portfolio Health', href: '/dashboard/health' },
  { key: 'attribution', label: 'Attribution', href: '/dashboard/attribution' },
  { key: 'local', label: 'Local Intel', href: '/dashboard/local' },
];

/** Not included in Admin / All reports. Only an explicit grant shows these. */
export const EXPLICIT_REPORT_KEYS = new Set(['traffic', 'all-dealers']);

export const DEFAULT_ACCESS = Object.freeze({
  role: 'admin',
  allReports: true,
  reportKeys: REPORT_OPTIONS.map((report) => report.key).filter(
    (key) => !EXPLICIT_REPORT_KEYS.has(key)
  ),
  allDealers: true,
  dealerIds: [],
});

const VALID_REPORT_KEYS = new Set(REPORT_OPTIONS.map((report) => report.key));

function explicitReportKeys(keys) {
  return (keys || []).filter(
    (key) => VALID_REPORT_KEYS.has(key) && EXPLICIT_REPORT_KEYS.has(key)
  );
}

export function normalizeAccess(row) {
  const reportKeys = (row?.report_keys || []).filter((key) => VALID_REPORT_KEYS.has(key));

  if (!row || row.role !== 'user') {
    return {
      ...DEFAULT_ACCESS,
      reportKeys: explicitReportKeys(reportKeys),
    };
  }

  return {
    role: 'user',
    allReports: row.all_reports === true,
    reportKeys,
    allDealers: row.all_dealers === true,
    dealerIds: (row.dealer_ids || [])
      .map(Number)
      .filter((id) => Number.isInteger(id) && id > 0),
  };
}

export function canAccessReport(access, key) {
  if (EXPLICIT_REPORT_KEYS.has(key)) {
    return Boolean(access?.reportKeys?.includes(key));
  }
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
