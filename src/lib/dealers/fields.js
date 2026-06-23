export const HOOT_TABLE = 'smart_hoot_config';
export const GA4_TABLE = 'smart_ga4_config';

export const FORM_FIELDS = [
  { key: 'customerName', db: 'customer_name', label: 'Dealer name', section: 'hoot', required: true },
  { key: 'hootUrl', db: 'hoot_url', label: 'Hoot URL', section: 'hoot', required: true },
  { key: 'hootId', db: 'hoot_id', label: 'Hoot ID', section: 'hoot' },
  {
    key: 'websitePlatform',
    db: 'website_platform',
    label: 'Website platform',
    section: 'hoot',
  },
  { key: 'isActive', db: 'is_active', label: 'Active', section: 'hoot', type: 'boolean' },
  {
    key: 'ga4CustomerId',
    db: 'client_id',
    label: 'GA4 customer ID',
    section: 'ga4',
    required: true,
  },
  {
    key: 'ga4PropertyId',
    db: 'ga4_property_id',
    label: 'GA4 property ID',
    section: 'ga4',
    required: true,
  },
  { key: 'accountName', db: 'account_name', label: 'Account name', section: 'ga4' },
  {
    key: 'ga4IsActive',
    db: 'is_active',
    label: 'GA4 config active',
    section: 'ga4',
    type: 'boolean',
  },
];

/** Strip `properties/` prefix; return numeric property id string. */
export function normalizeGa4PropertyId(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.replace(/^properties\//i, '').trim();
}

export function emptyFormState() {
  return {
    customerName: '',
    hootUrl: '',
    hootId: '',
    websitePlatform: '',
    isActive: true,
    ga4CustomerId: '',
    ga4PropertyId: '',
    accountName: '',
    ga4IsActive: true,
  };
}

export function rowToFormState(row) {
  const state = emptyFormState();
  if (!row) return state;
  state.customerName = row.customerName ?? '';
  state.hootUrl = row.hootUrl ?? '';
  state.hootId = row.hootId ?? '';
  state.websitePlatform = row.websitePlatform ?? '';
  state.isActive = row.isActive !== false;
  state.ga4CustomerId = row.ga4CustomerId ?? '';
  state.ga4PropertyId = row.ga4PropertyId ?? '';
  state.accountName = row.accountName ?? '';
  state.ga4IsActive = row.ga4IsActive !== false;
  return state;
}

export function normalizeDealerRow(hootRow, ga4Row) {
  const ga4CustomerId = hootRow?.ga4_customer_id
    ? String(hootRow.ga4_customer_id).trim()
    : null;
  const hasGa4Config = Boolean(ga4Row?.client_id && ga4Row?.ga4_property_id);

  return {
    id: hootRow.id,
    customerName: hootRow.customer_name ?? null,
    hootUrl: hootRow.hoot_url ?? null,
    hootId: hootRow.hoot_id ?? null,
    ga4CustomerId,
    websitePlatform: hootRow.website_platform ?? null,
    isActive: hootRow.is_active !== false,
    ga4ConfigId: ga4Row?.id ?? null,
    ga4PropertyId: ga4Row?.ga4_property_id
      ? normalizeGa4PropertyId(ga4Row.ga4_property_id)
      : null,
    accountName: ga4Row?.account_name ?? null,
    ga4IsActive: ga4Row?.is_active !== false,
    hasGa4Config,
    createdAt: hootRow.created_at ?? null,
  };
}

/** Open Vdp Logics add modal prefilled for a new dealer (does not filter the table). */
export function vdpLogicsAdminUrl(dealerName, meta = null) {
  const qs = new URLSearchParams();
  qs.set('add', '1');

  const name = String(dealerName || '').trim();
  if (name) qs.set('dealerName', name);

  if (meta && typeof meta === 'object') {
    const dealerId = String(meta.dealerId || meta.ga4CustomerId || '').trim();
    const cms = String(meta.cms || meta.websitePlatform || '').trim();
    const hootLink = String(meta.hootLink || meta.hootUrl || '').trim();
    if (dealerId) qs.set('dealerId', dealerId);
    if (cms) qs.set('cms', cms);
    if (hootLink) qs.set('hootLink', hootLink);
  } else {
    const dealerId = String(meta || '').trim();
    if (dealerId) qs.set('dealerId', dealerId);
  }

  return `/dashboard/admin/vdp-logics?${qs}`;
}

export function bodyToPayload(body) {
  const customerName = String(body?.customerName || '').trim();
  const hootUrl = String(body?.hootUrl || '').trim();
  const hootId = String(body?.hootId || '').trim() || null;
  const websitePlatform = String(body?.websitePlatform || '').trim() || null;
  const ga4CustomerId = String(body?.ga4CustomerId || '').trim();
  const ga4PropertyId = normalizeGa4PropertyId(body?.ga4PropertyId);
  const accountName =
    String(body?.accountName || '').trim() || customerName || null;
  const isActive = body?.isActive !== false;
  const ga4IsActive = body?.ga4IsActive !== false;

  if (!customerName) throw new Error('Dealer name is required.');
  if (!hootUrl) throw new Error('Hoot URL is required.');
  if (!ga4CustomerId) throw new Error('GA4 customer ID is required.');
  if (!ga4PropertyId) throw new Error('GA4 property ID is required.');

  return {
    customerName,
    hootUrl,
    hootId,
    websitePlatform,
    isActive,
    ga4CustomerId,
    ga4PropertyId,
    accountName,
    ga4IsActive,
  };
}
