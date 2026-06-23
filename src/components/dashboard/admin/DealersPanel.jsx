'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createAdminDealer,
  deleteAdminDealer,
  fetchAdminDealers,
  updateAdminDealer,
} from '@/lib/api/adminDealers';
import { vdpLogicsAdminUrl } from '@/lib/dealers/fields';
import AdminConfirmDialog from '@/components/dashboard/admin/AdminConfirmDialog';
import DealerFormModal from '@/components/dashboard/admin/DealerFormModal';

const EditIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);

const DeactivateIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <circle cx="12" cy="12" r="10" />
    <path d="m4.9 4.9 14.2 14.2" />
  </svg>
);

const DeleteIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M3 6h18" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
  </svg>
);

const COLUMNS = [
  { key: 'customerName', label: 'Dealer', sticky: true, width: '15%' },
  { key: 'ga4CustomerId', label: 'GA4 customer ID', width: '12%' },
  { key: 'ga4PropertyId', label: 'GA4 property ID', width: '11%' },
  { key: 'hootUrl', label: 'Hoot URL', wide: true, width: '28%' },
  { key: 'hootId', label: 'Hoot ID', width: '9%' },
  { key: 'websitePlatform', label: 'Platform', width: '10%' },
  { key: 'isActive', label: 'Active', width: '6%' },
  { key: 'configStatus', label: 'GA4 config', width: '9%' },
];

function ConfigBadge({ row }) {
  if (row.hasGa4Config) {
    return <span className="dealers-badge dealers-badge--ok">OK</span>;
  }
  return <span className="dealers-badge dealers-badge--warn">Missing</span>;
}

function formatCell(key, row) {
  if (key === 'isActive') return row.isActive ? 'Yes' : 'No';
  if (key === 'configStatus') return <ConfigBadge row={row} />;
  const val = row[key];
  if (val == null || val === '') return '—';
  if (key === 'hootUrl') {
    const s = String(val);
    if (/^https?:\/\//i.test(s)) {
      return (
        <a href={s} target="_blank" rel="noopener noreferrer" className="vdp-logics-link">
          {s.length > 48 ? `${s.slice(0, 48)}…` : s}
        </a>
      );
    }
  }
  return String(val);
}

function filterDealers(rows, { search = '', platform = '' } = {}) {
  const q = String(search || '').trim().toLowerCase();
  const platformFilter = String(platform || '').trim();

  return (rows || []).filter((row) => {
    if (platformFilter && String(row.websitePlatform || '').trim() !== platformFilter) {
      return false;
    }
    if (!q) return true;
    const hay = [
      row.customerName,
      row.ga4CustomerId,
      row.hootId,
      row.websitePlatform,
      row.hootUrl,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return hay.includes(q);
  });
}

export default function DealersPanel() {
  const [search, setSearch] = useState('');
  const [platform, setPlatform] = useState('');
  const [showInactive, setShowInactive] = useState(true);
  const [allRows, setAllRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [notice, setNotice] = useState(null);
  const [saving, setSaving] = useState(false);
  const [modal, setModal] = useState({ open: false, mode: 'create', row: null });
  const [confirm, setConfirm] = useState(null);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const json = await fetchAdminDealers({
        activeOnly: !showInactive,
      });
      setAllRows(json.rows || []);
    } catch (e) {
      setError(e?.message || 'Failed to load dealers.');
      setAllRows([]);
    } finally {
      setLoading(false);
    }
  }, [showInactive]);

  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(
    () => filterDealers(allRows, { search, platform }),
    [allRows, search, platform]
  );

  const platformOptions = useMemo(
    () =>
      [...new Set(allRows.map((row) => row.websitePlatform).filter(Boolean))].sort((a, b) =>
        String(a).localeCompare(String(b))
      ),
    [allRows]
  );

  const hasFilters = Boolean(search.trim() || platform);

  const openCreate = () => setModal({ open: true, mode: 'create', row: null });
  const openEdit = (row) => setModal({ open: true, mode: 'edit', row });
  const closeModal = () => setModal({ open: false, mode: 'create', row: null });

  const handleSave = async (form) => {
    setSaving(true);
    setMessage(null);
    setNotice(null);
    try {
      if (modal.mode === 'edit' && modal.row?.id) {
        await updateAdminDealer(modal.row.id, form);
        setMessage('Dealer updated.');
      } else {
        const result = await createAdminDealer(form);
        const dealerName = result.row?.customerName || form.customerName;
        setNotice({
          dealerName,
          href:
            result.vdpLogic?.vdpLogicsUrl ||
            vdpLogicsAdminUrl(dealerName, {
              dealerId: form.ga4CustomerId,
              cms: form.websitePlatform,
              hootLink: form.hootUrl,
            }),
        });
      }
      closeModal();
      load();
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = (row) => {
    if (!row?.id) return;
    setConfirm({ type: 'deactivate', row });
  };

  const handleDelete = (row) => {
    if (!row?.id) return;
    setConfirm({ type: 'delete', row });
  };

  const closeConfirm = () => {
    if (confirming) return;
    setConfirm(null);
  };

  const runConfirm = async () => {
    if (!confirm?.row?.id) return;
    const label = confirm.row.customerName || `ID ${confirm.row.id}`;
    setConfirming(true);
    setMessage(null);
    setNotice(null);
    setError(null);
    try {
      if (confirm.type === 'deactivate') {
        await deleteAdminDealer(confirm.row.id);
        setMessage(`"${label}" deactivated.`);
      } else {
        await deleteAdminDealer(confirm.row.id, { hard: true });
        setMessage(`"${label}" deleted.`);
      }
      setConfirm(null);
      load();
    } catch (e) {
      setError(e?.message || (confirm.type === 'deactivate' ? 'Deactivate failed.' : 'Delete failed.'));
    } finally {
      setConfirming(false);
    }
  };

  const confirmCopy =
    confirm?.type === 'delete'
      ? {
          title: 'Delete dealer',
          message: `Permanently delete "${confirm.row.customerName || `ID ${confirm.row.id}`}"? This removes smart_hoot_config and smart_ga4_config rows. If GA4 page data exists, deletion is blocked — use Deactivate instead.`,
          confirmLabel: 'Delete',
          danger: true,
        }
      : confirm
        ? {
            title: 'Deactivate dealer',
            message: `Deactivate "${confirm.row.customerName || `ID ${confirm.row.id}`}"? The dealer will be hidden from the dashboard picker. Historical analytics data is kept.`,
            confirmLabel: 'Deactivate',
            danger: false,
          }
        : null;

  return (
    <div className="ga4-count-page vdp-logics-page dealers-page">
      <header className="ga4-count-toolbar">
        <h1 className="ga4-count-title">Dealers</h1>
        <div className="ga4-count-filters-row vdp-logics-filters">
          <label className="admin-date-field ga4-count-dealer-field vdp-logics-search-field">
            <span className="admin-date-label">Search</span>
            <input
              type="search"
              className="ga4-count-search"
              placeholder="Name, GA4 ID, platform…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <label className="admin-date-field ga4-count-dealer-field">
            <span className="admin-date-label">Platform</span>
            <select
              className="ga4-count-select"
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              disabled={loading}
            >
              <option value="">All platforms</option>
              {platformOptions.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className="admin-date-field ga4-count-dealer-field dealers-filter-check">
            <span className="admin-date-label">Inactive</span>
            <select
              className="ga4-count-select"
              value={showInactive ? 'all' : 'active'}
              onChange={(e) => setShowInactive(e.target.value === 'all')}
              disabled={loading}
            >
              <option value="all">Show all</option>
              <option value="active">Active only</option>
            </select>
          </label>
        </div>
        <div className="ga4-count-actions vdp-logics-actions">
          <button type="button" className="ga4-count-export-btn" onClick={openCreate}>
            Add dealer
          </button>
          <button
            type="button"
            className="ga4-count-export-btn"
            onClick={load}
            disabled={loading}
          >
            Refresh
          </button>
        </div>
      </header>

      {notice && (
        <div className="dealers-notice" role="status">
          <p>
            Dealer <strong>{notice.dealerName}</strong> added. Add a VDP logic row using the same
            template as existing dealers.{' '}
            <Link href={notice.href} className="dealers-notice-link">
              Open Vdp Logics to add row
            </Link>
          </p>
          <button
            type="button"
            className="dealers-notice-dismiss"
            onClick={() => setNotice(null)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      <p className="ga4-count-meta vdp-logics-example-hint">
        {loading && 'Loading smart_hoot_config…'}
        {!loading && error && <span className="ga4-count-error-text">{error}</span>}
        {!loading && !error && message && <span>{message}</span>}
        {!loading && !error && !message && (
          <>
            {hasFilters
              ? `${rows.length.toLocaleString()} of ${allRows.length.toLocaleString()} dealer${allRows.length === 1 ? '' : 's'}`
              : `${allRows.length.toLocaleString()} dealer${allRows.length === 1 ? '' : 's'}`}{' '}
            · writes <code>smart_hoot_config</code> + <code>smart_ga4_config</code>
          </>
        )}
      </p>

      {error && !loading && (
        <div className="ga4-count-alert">
          <p>{error}</p>
          <button type="button" className="ga4-count-retry-btn" onClick={load}>
            Retry
          </button>
        </div>
      )}

      {loading && (
        <div className="ga4-count-skeleton" aria-hidden="true">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="ga4-count-skeleton-row" />
          ))}
        </div>
      )}

      {!loading && !error && allRows.length > 0 && (
        <div className="ga4-count-scroll vdp-logics-scroll">
          <table className="ga4-count-table vdp-logics-table dealers-table-layout">
            <colgroup>
              <col style={{ width: 108 }} />
              {COLUMNS.map((col) => (
                <col key={col.key} style={{ width: col.width }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th className="ga4-count-sticky-col vdp-logics-actions-col">Actions</th>
                {COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    className={
                      col.sticky
                        ? 'ga4-count-sticky-col ga4-count-client vdp-logics-dealer-col'
                        : ''
                    }
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length > 0 ? (
                rows.map((row) => (
                  <tr key={row.id} className={row.isActive ? '' : 'dealers-row--inactive'}>
                  <td className="ga4-count-sticky-col vdp-logics-actions-col">
                    <div className="vdp-logics-actions-inner dealers-actions-inner">
                      <button
                        type="button"
                        className="vdp-logics-action-btn vdp-logics-action-btn--icon"
                        onClick={() => openEdit(row)}
                        aria-label={`Edit ${row.customerName || 'dealer'}`}
                        title="Edit"
                      >
                        <EditIcon />
                      </button>
                      {row.isActive && (
                        <button
                          type="button"
                          className="vdp-logics-action-btn vdp-logics-action-btn--icon"
                          onClick={() => handleDeactivate(row)}
                          aria-label={`Deactivate ${row.customerName || 'dealer'}`}
                          title="Deactivate"
                        >
                          <DeactivateIcon />
                        </button>
                      )}
                      <button
                        type="button"
                        className="vdp-logics-action-btn vdp-logics-action-btn--icon vdp-logics-action-btn--danger"
                        onClick={() => handleDelete(row)}
                        aria-label={`Delete ${row.customerName || 'dealer'}`}
                        title="Delete"
                      >
                        <DeleteIcon />
                      </button>
                    </div>
                  </td>
                  {COLUMNS.map((col) => (
                    <td
                      key={col.key}
                      className={[
                        'ga4-count-cell',
                        col.sticky
                          ? 'ga4-count-sticky-col ga4-count-client vdp-logics-dealer-col'
                          : '',
                        col.wide ? 'vdp-logics-cell--wide' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      {formatCell(col.key, row)}
                    </td>
                  ))}
                </tr>
                ))
              ) : (
                <tr className="dealers-empty-row">
                  <td colSpan={COLUMNS.length + 1} className="dealers-empty-cell">
                    No dealers match your search or platform filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !error && allRows.length === 0 && (
        <p className="ga4-count-meta">
          No dealers found. Use <strong>Add dealer</strong> to create{' '}
          <code>smart_hoot_config</code> + <code>smart_ga4_config</code> rows.
        </p>
      )}

      <DealerFormModal
        open={modal.open}
        mode={modal.mode}
        initialRow={modal.row}
        saving={saving}
        onClose={closeModal}
        onSave={handleSave}
      />

      <AdminConfirmDialog
        open={Boolean(confirm)}
        title={confirmCopy?.title || ''}
        message={confirmCopy?.message || ''}
        confirmLabel={confirmCopy?.confirmLabel || 'Confirm'}
        danger={confirmCopy?.danger}
        loading={confirming}
        onConfirm={runConfirm}
        onCancel={closeConfirm}
      />
    </div>
  );
}
