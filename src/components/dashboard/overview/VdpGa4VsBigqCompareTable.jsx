'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Panel, PanelHeader, PanelBody } from '@/components/dashboard/Panel';
import { fetchVdpGa4VsBigqCompare } from '@/lib/api/vdpGa4VsBigqCompare';
import Ga4BigqCompareExportButton from '@/components/dashboard/overview/Ga4BigqCompareExportButton';

function fmtNum(n) {
  return Number(n || 0).toLocaleString();
}

function fmtPct(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const v = Number(n);
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(2)}%`;
}

function deltaClass(n) {
  if (n == null || n === 0) return '';
  return n > 0 ? 'vdp-bq-delta-pos' : 'vdp-bq-delta-neg';
}

const STATUS_LABELS = {
  matched: 'Matched',
  missing_from_report: 'Missing from report',
  ga4_only: 'GA4 only',
  bigq_only: 'BigQ only',
  other: 'Other',
};

function statusClass(status) {
  if (status === 'missing_from_report') return 'vdp-bq-status-missing';
  if (status === 'matched') return 'vdp-bq-status-matched';
  if (status === 'ga4_only') return 'vdp-bq-status-ga4';
  if (status === 'bigq_only') return 'vdp-bq-status-bigq';
  return '';
}

/**
 * All-dealer GA4 vs BigQuery VDP compare (BigQ capped at today − 2).
 */
export default function VdpGa4VsBigqCompareTable({ from, to, showExport = false }) {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchVdpGa4VsBigqCompare({ from, to, status: statusFilter })
      .then((result) => {
        if (cancelled) return;
        setRows(result.rows);
        setMeta(result.meta || {});
      })
      .catch((err) => {
        if (cancelled) return;
        setRows([]);
        setMeta({});
        setError(err?.message || 'Failed to load VDP compare');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [from, to, statusFilter]);

  const subtitle = useMemo(() => {
    const parts = ['All dealers'];
    if (meta.from && meta.to) parts.push(`${meta.from} → ${meta.to}`);
    if (meta.bigqCapTo) parts.push(`BigQ ≤ ${meta.bigqCapTo}`);
    if (meta.missingFromReport != null) {
      parts.push(`${meta.missingFromReport} missing from report`);
    }
    return parts.join(' · ');
  }, [meta.from, meta.to, meta.bigqCapTo, meta.missingFromReport]);

  const fetchAllRowsForExport = useCallback(() => {
    if (statusFilter === 'all') {
      return Promise.resolve({ rows, meta });
    }
    return fetchVdpGa4VsBigqCompare({ from, to, status: 'all' });
  }, [from, to, statusFilter, rows, meta]);

  return (
    <Panel className="vdp-bq-compare-panel">
      <PanelHeader
        title="VDP Views Compare — GA4 vs BigQuery (All Dealers)"
        subtitle={subtitle}
      >
        <div className="vdp-bq-header-actions">
          {showExport && (
            <Ga4BigqCompareExportButton
              rows={rows}
              meta={meta}
              loading={loading}
              fetchAllRows={fetchAllRowsForExport}
            />
          )}
          <div className="vdp-bq-status-filters">
          {[
            { id: 'all', label: 'All' },
            { id: 'missing_from_report', label: 'Missing from report' },
            { id: 'matched', label: 'Matched' },
            { id: 'ga4_only', label: 'GA4 only' },
            { id: 'bigq_only', label: 'BigQ only' },
          ].map((opt) => (
            <button
              key={opt.id}
              type="button"
              className={`vdp-bq-filter-btn${statusFilter === opt.id ? ' active' : ''}`}
              onClick={() => setStatusFilter(opt.id)}
            >
              {opt.label}
            </button>
          ))}
          </div>
        </div>
      </PanelHeader>
      <PanelBody className="vdp-bq-compare-body">
        <p className="vdp-bq-compare-note">
          <strong>Profile ID</strong> = <code>ga4_property_id</code> = BigQ{' '}
          <code>profile_id</code>
          {' · '}
          <strong>GA4 VDP</strong> = <code>vdp_conditions = true</code>
          {' · '}
          <strong>Missing from report</strong> = BigQ has VDP data but no dealer
          in <code>smart_ga4_config</code> / VDP report
        </p>

        {loading && (
          <div className="cmp-table-loading">Loading all-dealer comparison…</div>
        )}
        {!loading && error && (
          <div className="cmp-table-error">{error}</div>
        )}
        {!loading && !error && rows.length === 0 && (
          <div className="cmp-table-loading">
            No dealers for this filter / date range.
          </div>
        )}
        {!loading && !error && rows.length > 0 && (
          <div className="vdp-bq-compare-wrap">
            <table className="vdp-bq-compare-table">
              <colgroup>
                <col className="vdp-bq-col-dealer" />
                <col className="vdp-bq-col-property" />
                <col className="vdp-bq-col-status" />
                <col className="vdp-bq-col-num" />
                <col className="vdp-bq-col-num" />
                <col className="vdp-bq-col-num" />
                <col className="vdp-bq-col-pct" />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">Dealer</th>
                  <th scope="col">Profile ID</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="num">
                    GA4 VDP views
                  </th>
                  <th scope="col" className="num">
                    BigQ VDP views
                  </th>
                  <th scope="col" className="num">
                    Delta (BigQ − GA4)
                  </th>
                  <th scope="col" className="num">
                    Δ %
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.propertyId || row.accountName}
                    className={
                      row.matchStatus === 'missing_from_report'
                        ? 'vdp-bq-row-missing'
                        : ''
                    }
                  >
                    <td className="vdp-bq-td-dealer">
                      <span className="vdp-bq-dealer-name">
                        {row.accountName || '—'}
                      </span>
                    </td>
                    <td className="vdp-bq-td-property">
                      {row.propertyId || '—'}
                    </td>
                    <td>
                      <span
                        className={`vdp-bq-status-pill ${statusClass(row.matchStatus)}`}
                      >
                        {STATUS_LABELS[row.matchStatus] || row.matchStatus}
                      </span>
                    </td>
                    <td className="num">{fmtNum(row.ga4VdpViews)}</td>
                    <td className="num">{fmtNum(row.bigqVdpViews)}</td>
                    <td className={`num ${deltaClass(row.deltaViews)}`}>
                      {row.deltaViews > 0 ? '+' : ''}
                      {fmtNum(row.deltaViews)}
                    </td>
                    <td className={`num ${deltaClass(row.deltaPct)}`}>
                      {fmtPct(row.deltaPct)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="vdp-bq-td-dealer" colSpan={3}>
                    <strong>Total</strong>
                    {meta.dealerCount != null
                      ? ` (${meta.dealerCount} rows)`
                      : ''}
                  </td>
                  <td className="num">
                    <strong>{fmtNum(meta.ga4Total)}</strong>
                  </td>
                  <td className="num">
                    <strong>{fmtNum(meta.bigqTotal)}</strong>
                  </td>
                  <td className={`num ${deltaClass(meta.deltaTotal)}`}>
                    <strong>
                      {(meta.deltaTotal || 0) > 0 ? '+' : ''}
                      {fmtNum(meta.deltaTotal)}
                    </strong>
                  </td>
                  <td className={`num ${deltaClass(meta.deltaPctTotal)}`}>
                    <strong>{fmtPct(meta.deltaPctTotal)}</strong>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </PanelBody>
    </Panel>
  );
}
