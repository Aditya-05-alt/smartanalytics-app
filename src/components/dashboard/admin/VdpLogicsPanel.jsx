'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createVdpLogic,
  deleteVdpLogic,
  downloadExampleVdpLogicsCsv,
  fetchVdpLogics,
  updateVdpLogic,
  uploadVdpLogicsCsv,
} from '@/lib/api/vdpLogics';
import { EXAMPLE_ROW } from '@/lib/vdpLogics/fields';
import VdpLogicsFormModal from '@/components/dashboard/admin/VdpLogicsFormModal';

const COLUMNS = [
  { key: 'dealerName', label: 'Dealer', sticky: true },
  { key: 'dealerId', label: 'Dealer ID' },
  { key: 'websiteUrl', label: 'Website' },
  { key: 'cms', label: 'CMS' },
  { key: 'dataSource', label: 'Data source' },
  { key: 'hootLink', label: 'Hoot link' },
  { key: 'scrapLink', label: 'Scrap link' },
  { key: 'vdpLogic', label: 'VDP logic', wide: true },
  { key: 'srpLogic', label: 'SRP logic', wide: true },
  { key: 'homePageLogic', label: 'Home logic', wide: true },
  { key: 'others', label: 'Others', wide: true },
  { key: 'updatedAt', label: 'Updated' },
];

function formatCell(key, value) {
  if (value == null || value === '') return '—';
  if (key === 'updatedAt' || key === 'createdAt') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString();
  }
  if (key === 'websiteUrl' || key === 'hootLink' || key === 'scrapLink') {
    const s = String(value);
    if (/^https?:\/\//i.test(s)) {
      return (
        <a href={s} target="_blank" rel="noopener noreferrer" className="vdp-logics-link">
          {s.length > 48 ? `${s.slice(0, 48)}…` : s}
        </a>
      );
    }
  }
  return String(value);
}

export default function VdpLogicsPanel() {
  const fileInputRef = useRef(null);
  const [search, setSearch] = useState('');
  const [cms, setCms] = useState('');
  const [dataSource, setDataSource] = useState('');
  const [rows, setRows] = useState([]);
  const [filterOptions, setFilterOptions] = useState({ cmsOptions: [], dataSourceOptions: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modal, setModal] = useState({ open: false, mode: 'create', row: null });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const json = await fetchVdpLogics({ search, cms, dataSource });
      setRows(json.rows || []);
      if (!search && !cms && !dataSource) {
        setFilterOptions(json.filters || { cmsOptions: [], dataSourceOptions: [] });
      }
    } catch (e) {
      setError(e?.message || 'Failed to load VDP logics.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [search, cms, dataSource]);

  useEffect(() => {
    const t = setTimeout(load, search ? 280 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  const cmsOptions = useMemo(
    () => filterOptions.cmsOptions || [],
    [filterOptions.cmsOptions]
  );
  const dataSourceOptions = useMemo(
    () => filterOptions.dataSourceOptions || [],
    [filterOptions.dataSourceOptions]
  );

  const openCreate = () => setModal({ open: true, mode: 'create', row: null });
  const openEdit = (row) => setModal({ open: true, mode: 'edit', row });
  const closeModal = () => setModal({ open: false, mode: 'create', row: null });

  const handleSave = async (form) => {
    setSaving(true);
    setMessage(null);
    try {
      if (modal.mode === 'edit' && modal.row?.id) {
        await updateVdpLogic(modal.row.id, form);
        setMessage('Row updated.');
      } else {
        await createVdpLogic(form);
        setMessage('Row created.');
      }
      closeModal();
      load();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row) => {
    if (!row?.id) return;
    const label = row.dealerName || `ID ${row.id}`;
    if (!window.confirm(`Delete VDP logic for "${label}"?`)) return;
    setMessage(null);
    setError(null);
    try {
      await deleteVdpLogic(row.id);
      setMessage('Row deleted.');
      load();
    } catch (e) {
      setError(e?.message || 'Delete failed.');
    }
  };

  const handleCsvPick = () => fileInputRef.current?.click();

  const handleCsvFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    setMessage(null);
    setError(null);
    try {
      const result = await uploadVdpLogicsCsv(file);
      const errCount = result.rowErrors?.length ?? 0;
      setMessage(
        `CSV import: ${result.imported ?? 0} of ${result.total ?? 0} rows` +
          (errCount ? ` (${errCount} issue${errCount === 1 ? '' : 's'})` : '.')
      );
      if (errCount) {
        setError(
          result.rowErrors
            .slice(0, 5)
            .map((x) => (x.line ? `Line ${x.line}: ${x.message}` : x.message))
            .join(' · ')
        );
      }
      load();
    } catch (err) {
      setError(err?.message || 'CSV upload failed.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="ga4-count-page vdp-logics-page">
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,text/csv"
        className="vdp-logics-file-input"
        aria-hidden
        tabIndex={-1}
        onChange={handleCsvFile}
      />

      <header className="ga4-count-toolbar">
        <h1 className="ga4-count-title">Vdp - Logics</h1>
        <div className="ga4-count-filters-row vdp-logics-filters">
          <label className="admin-date-field ga4-count-dealer-field vdp-logics-search-field">
            <span className="admin-date-label">Search</span>
            <input
              type="search"
              className="ga4-count-search"
              placeholder="Dealer, URL, logic…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <label className="admin-date-field ga4-count-dealer-field">
            <span className="admin-date-label">CMS</span>
            <select
              className="ga4-count-select"
              value={cms}
              onChange={(e) => setCms(e.target.value)}
              disabled={loading}
            >
              <option value="">All CMS</option>
              {cmsOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="admin-date-field ga4-count-dealer-field">
            <span className="admin-date-label">Data source</span>
            <select
              className="ga4-count-select"
              value={dataSource}
              onChange={(e) => setDataSource(e.target.value)}
              disabled={loading}
            >
              <option value="">All sources</option>
              {dataSourceOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="ga4-count-actions vdp-logics-actions">
          <button type="button" className="ga4-count-export-btn" onClick={openCreate}>
            Add row
          </button>
          <button
            type="button"
            className="ga4-count-export-btn"
            onClick={downloadExampleVdpLogicsCsv}
          >
            Example CSV
          </button>
          <button
            type="button"
            className="ga4-count-export-btn"
            onClick={handleCsvPick}
            disabled={uploading}
          >
            {uploading ? 'Uploading…' : 'Upload CSV'}
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

      <p className="ga4-count-meta vdp-logics-example-hint">
        {loading && 'Loading smart_vdp_logic…'}
        {!loading && error && <span className="ga4-count-error-text">{error}</span>}
        {!loading && !error && message && <span>{message}</span>}
        {!loading && !error && !message && (
          <>
            {rows.length.toLocaleString()} row{rows.length === 1 ? '' : 's'} · CSV upserts on{' '}
            <code>dealer_name</code> + <code>website_url</code>
          </>
        )}
      </p>

      <details className="vdp-logics-example-box">
        <summary>Example row (template)</summary>
        <dl className="vdp-logics-example-dl">
          {Object.entries(EXAMPLE_ROW).map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </details>

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

      {!loading && !error && rows.length > 0 && (
        <div className="ga4-count-scroll vdp-logics-scroll">
          <table className="ga4-count-table vdp-logics-table">
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
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="ga4-count-sticky-col vdp-logics-actions-col">
                    <div className="vdp-logics-actions-inner">
                      <button
                        type="button"
                        className="vdp-logics-action-btn"
                        onClick={() => openEdit(row)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="vdp-logics-action-btn vdp-logics-action-btn--danger"
                        onClick={() => handleDelete(row)}
                      >
                        Delete
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
                      {formatCell(col.key, row[col.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <p className="ga4-count-meta">
          No rows yet. Use <strong>Add row</strong>, <strong>Upload CSV</strong>, or download{' '}
          <strong>Example CSV</strong>.
        </p>
      )}

      <VdpLogicsFormModal
        open={modal.open}
        mode={modal.mode}
        initialRow={modal.row}
        saving={saving}
        onClose={closeModal}
        onSave={handleSave}
      />
    </div>
  );
}
