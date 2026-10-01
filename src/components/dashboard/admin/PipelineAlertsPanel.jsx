'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  PIPELINE_ALERTS_EVENT,
  PIPELINE_STEP_LABELS,
  broadcastPipelineAlerts,
  fetchPipelineAlerts,
  pipelineFixHref,
  recheckPipelineAlertDealers,
  refreshPipelineAlerts,
  subscribeRemotePipelineAlerts,
} from '@/lib/api/adminPipelineAlerts';

const SEVERITY_LABELS = { error: 'Failed', warning: 'Check', pending: 'Settling', success: 'OK' };
const SEVERITY_RANK = { error: 0, warning: 1, pending: 2, success: 3 };
const BANNER_DISMISS_KEY = 'pipeline-alerts:banner-dismissed';

function dateRange(from, to) {
  if (!from || !to) return [];
  const out = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end && out.length < 32) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

function CountsCell({ counts }) {
  if (!counts) return '—';
  return (
    <span className="pipeline-alerts-counts">
      GA4 {counts.pageRows} · VDP {counts.vdpRows} · Final {counts.finalRows}
      {counts.unfilteredRows > 0 && ` · Unfiltered ${counts.unfilteredRows}`}
    </span>
  );
}

export default function PipelineAlertsPanel() {
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [severity, setSeverity] = useState('active');
  const [step, setStep] = useState('all');
  const [search, setSearch] = useState('');
  const [recheckingIds, setRecheckingIds] = useState(() => new Set());
  const [view, setView] = useState('issues');

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      setSnapshot(await fetchPipelineAlerts());
    } catch (e) {
      setError(e?.message || 'Failed to load pipeline alerts.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const onUpdated = (e) => {
      if (e.detail) setSnapshot(e.detail);
    };
    window.addEventListener(PIPELINE_ALERTS_EVENT, onUpdated);
    const unsubscribe = subscribeRemotePipelineAlerts(() => load({ silent: true }));
    return () => {
      window.removeEventListener(PIPELINE_ALERTS_EVENT, onUpdated);
      unsubscribe();
    };
  }, [load]);

  const recheck = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const next = await refreshPipelineAlerts();
      setSnapshot(next);
      broadcastPipelineAlerts(next);
    } catch (e) {
      setError(e?.message || 'Failed to re-check pipeline.');
    } finally {
      setRefreshing(false);
    }
  }, []);

  const recheckDealers = useCallback(async (dealerIds) => {
    const ids = dealerIds.filter((id) => id != null).map(String);
    if (ids.length === 0) return;
    setRecheckingIds((prev) => new Set([...prev, ...ids]));
    setError(null);
    try {
      const next = await recheckPipelineAlertDealers(ids.map(Number));
      setSnapshot(next);
      broadcastPipelineAlerts(next);
    } catch (e) {
      setError(e?.message || 'Failed to re-check dealer.');
    } finally {
      setRecheckingIds((prev) => {
        const s = new Set(prev);
        ids.forEach((id) => s.delete(id));
        return s;
      });
    }
  }, []);

  const resolvedRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (snapshot?.resolved || []).filter(
      (a) =>
        (step === 'all' || String(a.step) === step) &&
        (!q || a.dealerName?.toLowerCase().includes(q) || a.clientId?.toLowerCase().includes(q))
    );
  }, [snapshot, step, search]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (severity === 'resolved') return [];
    return (snapshot?.alerts || [])
      .filter((a) => {
        if (severity === 'active' && a.severity === 'pending') return false;
        if (severity !== 'active' && severity !== 'all' && a.severity !== severity) return false;
        if (step !== 'all' && String(a.step) !== step) return false;
        if (q && !a.dealerName?.toLowerCase().includes(q) && !a.clientId?.toLowerCase().includes(q)) {
          return false;
        }
        return true;
      })
      .sort(
        (x, y) =>
          SEVERITY_RANK[x.severity] - SEVERITY_RANK[y.severity] ||
          (x.dealerName || '').localeCompare(y.dealerName || '') ||
          String(x.reportDate).localeCompare(String(y.reportDate))
      );
  }, [snapshot, severity, step, search]);

  const dealerCount = useMemo(
    () => new Set(rows.map((r) => r.dealerId ?? r.dealerName)).size,
    [rows]
  );

  const listedDealerIds = useMemo(
    () => [...new Set(rows.map((r) => r.dealerId).filter((id) => id != null).map(String))],
    [rows]
  );

  const dealerStatus = useMemo(() => {
    const list = snapshot?.dealers;
    if (!Array.isArray(list)) return null;
    const failing = list.filter((d) => d.status === 'error' || d.status === 'warning');
    return {
      total: list.length,
      ok: list.filter((d) => d.status === 'success').length,
      failing,
    };
  }, [snapshot]);

  const dealerRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (snapshot?.dealers || [])
      .filter(
        (d) => !q || d.dealerName?.toLowerCase().includes(q) || d.clientId?.toLowerCase().includes(q)
      )
      .sort(
        (x, y) =>
          SEVERITY_RANK[x.status] - SEVERITY_RANK[y.status] ||
          (x.dealerName || '').localeCompare(y.dealerName || '')
      );
  }, [snapshot, search]);

  const checkedDates = useMemo(() => dateRange(snapshot?.from, snapshot?.to), [snapshot]);

  const bannerKey = dealerStatus
    ? `${snapshot?.from}|${snapshot?.to}|${dealerStatus.ok}/${dealerStatus.total}|${dealerStatus.failing
        .map((d) => d.dealerId)
        .join(',')}`
    : null;
  const [dismissedBanner, setDismissedBanner] = useState(null);
  useEffect(() => {
    try {
      setDismissedBanner(window.localStorage.getItem(BANNER_DISMISS_KEY));
    } catch {
      /* storage unavailable */
    }
  }, []);
  const dismissBanner = () => {
    setDismissedBanner(bannerKey);
    try {
      window.localStorage.setItem(BANNER_DISMISS_KEY, bannerKey);
    } catch {
      /* storage unavailable */
    }
  };

  const rechecked = snapshot?.recheckedDealers || {};
  const busyAll = refreshing || loading;
  const listRechecking = listedDealerIds.length > 0 && listedDealerIds.every((id) => recheckingIds.has(id));

  const counts = snapshot?.counts || { error: 0, warning: 0, pending: 0 };

  return (
    <div className="ga4-count-page pipeline-alerts-page">
      <header className="ga4-count-toolbar">
        <h1 className="ga4-count-title">Pipeline Alerts</h1>
        <div className="ga4-count-filters-row pipeline-alerts-filters">
          <div className="pipeline-alerts-view" role="tablist" aria-label="View">
            <button
              type="button"
              role="tab"
              aria-selected={view === 'issues'}
              className={`pipeline-alerts-view-btn ${view === 'issues' ? 'is-active' : ''}`}
              onClick={() => setView('issues')}
            >
              Issues
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'dealers'}
              className={`pipeline-alerts-view-btn ${view === 'dealers' ? 'is-active' : ''}`}
              onClick={() => setView('dealers')}
            >
              All dealers{dealerStatus ? ` (${dealerStatus.total})` : ''}
            </button>
          </div>
          {view === 'issues' && (
          <>
          <label className="admin-date-field">
            <span className="admin-date-label">Status</span>
            <select
              className="ga4-count-select"
              value={severity}
              onChange={(e) => setSeverity(e.target.value)}
            >
              <option value="active">Failed + Check</option>
              <option value="error">Failed</option>
              <option value="warning">Check</option>
              <option value="pending">Settling</option>
              <option value="resolved">Fixed</option>
              <option value="all">All</option>
            </select>
          </label>
          <label className="admin-date-field">
            <span className="admin-date-label">Step</span>
            <select className="ga4-count-select" value={step} onChange={(e) => setStep(e.target.value)}>
              <option value="all">All steps</option>
              {[1, 2, 3, 0].map((s) => (
                <option key={s} value={String(s)}>
                  {PIPELINE_STEP_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          </>
          )}
          <label className="admin-date-field daily-sync-search">
            <span className="admin-date-label">Search</span>
            <input
              type="search"
              className="ga4-count-search"
              placeholder="Dealer name or client ID"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          {view === 'issues' && (
          <button
            type="button"
            className="ga4-count-retry-btn pipeline-alerts-btn-secondary"
            onClick={() => recheckDealers(listedDealerIds)}
            disabled={busyAll || listedDealerIds.length === 0 || listRechecking}
            title="Re-check only the dealers in the list below (about 2s per dealer)"
          >
            {listRechecking ? 'Re-checking…' : `Re-check listed dealers (${listedDealerIds.length})`}
          </button>
          )}
          <button
            type="button"
            className="ga4-count-retry-btn"
            onClick={recheck}
            disabled={busyAll}
            title="Re-check every active dealer"
          >
            {refreshing ? 'Checking… (up to 1 min)' : 'Re-check all'}
          </button>
        </div>
      </header>

      <p className="ga4-count-meta">
        {snapshot ? (
          <>
            Checked {formatDateTime(snapshot.generatedAt)} ({snapshot.triggeredBy}) for{' '}
            {snapshot.from} → {snapshot.to}. GA4 data takes 48–72h to settle, so the latest{' '}
            {snapshot.settleDays ?? 2} days are not alerted. Runs automatically at 06:30 and 12:30 UTC.
            {snapshot.lastDealerRecheckAt &&
              ` Last dealer re-check ${formatDateTime(snapshot.lastDealerRecheckAt)}.`}
          </>
        ) : (
          !loading && 'No check has run yet — click Re-check now.'
        )}
        {error && <span className="ga4-count-error-text"> {error}</span>}
      </p>

      {snapshot && dealerStatus && dismissedBanner !== bannerKey && (
        <div
          className={`pipeline-alerts-banner pipeline-alerts-banner--${
            dealerStatus.failing.length === 0 ? 'success' : 'error'
          }`}
        >
          <span className="pipeline-alerts-banner-text">
            {dealerStatus.failing.length === 0 ? (
              <>
                All {dealerStatus.total} dealers passed every step for {snapshot.from} → {snapshot.to}.
              </>
            ) : (
              <>
                {dealerStatus.ok} of {dealerStatus.total} dealers passed every step.{' '}
                {dealerStatus.failing.length} need attention:{' '}
                <strong>{dealerStatus.failing.map((d) => d.dealerName).join(', ')}</strong>
              </>
            )}
          </span>
          <button
            type="button"
            className="pipeline-alerts-banner-close"
            onClick={dismissBanner}
            aria-label="Dismiss"
            title="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      {snapshot && (
        <div className="pipeline-alerts-summary">
          {dealerStatus && (
            <div className="pipeline-alerts-card pipeline-alerts-card--resolved">
              <span className="pipeline-alerts-card-num">
                {dealerStatus.ok}
                <span className="pipeline-alerts-card-of"> / {dealerStatus.total}</span>
              </span>
              <span className="pipeline-alerts-card-label">Dealers OK</span>
            </div>
          )}
          <div className="pipeline-alerts-card pipeline-alerts-card--error">
            <span className="pipeline-alerts-card-num">{counts.error}</span>
            <span className="pipeline-alerts-card-label">Failed</span>
          </div>
          <div className="pipeline-alerts-card pipeline-alerts-card--warning">
            <span className="pipeline-alerts-card-num">{counts.warning}</span>
            <span className="pipeline-alerts-card-label">Check</span>
          </div>
          <div className="pipeline-alerts-card pipeline-alerts-card--pending">
            <span className="pipeline-alerts-card-num">{counts.pending}</span>
            <span className="pipeline-alerts-card-label">Settling</span>
          </div>
          <div className="pipeline-alerts-card pipeline-alerts-card--resolved">
            <span className="pipeline-alerts-card-num">{snapshot.resolved?.length || 0}</span>
            <span className="pipeline-alerts-card-label">Fixed</span>
          </div>
          {view === 'issues' && (
            <div className="pipeline-alerts-card">
              <span className="pipeline-alerts-card-num">{dealerCount}</span>
              <span className="pipeline-alerts-card-label">Dealers with issues</span>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="ga4-count-skeleton" aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="ga4-count-skeleton-row" />
          ))}
        </div>
      ) : view === 'dealers' ? (
        <div className="ga4-count-scroll">
          <table className="ga4-count-table pipeline-alerts-table">
            <thead>
              <tr>
                <th className="ga4-count-sticky-col">Dealer</th>
                <th>Status</th>
                {checkedDates.map((d) => (
                  <th key={d}>{d}</th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {!dealerStatus ? (
                <tr>
                  <td colSpan={checkedDates.length + 3} className="ga4-count-empty-row">
                    This check predates the dealer list — click Re-check all.
                  </td>
                </tr>
              ) : dealerRows.length === 0 ? (
                <tr>
                  <td colSpan={checkedDates.length + 3} className="ga4-count-empty-row">
                    No dealers match.
                  </td>
                </tr>
              ) : (
                dealerRows.map((d) => {
                  const idKey = d.dealerId != null ? String(d.dealerId) : null;
                  const busy = idKey != null && recheckingIds.has(idKey);
                  const byDate = Object.fromEntries((d.days || []).map((x) => [x.date, x]));
                  const firstIssue = (d.days || []).find((x) => x.severity !== 'success');
                  return (
                    <tr key={`dealer-${d.dealerId}`}>
                      <th className="ga4-count-sticky-col ga4-count-client" scope="row">
                        <span className="daily-sync-dealer-name">{d.dealerName}</span>
                        {d.clientId && <span className="daily-sync-client-id">{d.clientId}</span>}
                      </th>
                      <td>
                        <span className={`pipeline-alert-pill pipeline-alert-pill--${d.status}`}>
                          {SEVERITY_LABELS[d.status]}
                        </span>
                      </td>
                      {checkedDates.map((date) => {
                        const day = byDate[date];
                        if (!day) {
                          return (
                            <td key={date} className="pipeline-alerts-day">
                              {d.clientId ? '—' : 'No GA4 ID'}
                            </td>
                          );
                        }
                        return (
                          <td key={date} className="pipeline-alerts-day">
                            {day.severity === 'success' ? (
                              <span className="pipeline-alerts-day-ok" title="All 3 steps done">
                                ✓
                              </span>
                            ) : (
                              <span
                                className={`pipeline-alert-pill pipeline-alert-pill--${day.severity}`}
                                title={day.code}
                              >
                                Step {day.step}
                              </span>
                            )}
                          </td>
                        );
                      })}
                      <td className="pipeline-alerts-actions">
                        {firstIssue && (
                          <Link
                            href={pipelineFixHref({ dealerId: d.dealerId, reportDate: firstIssue.date })}
                            prefetch={false}
                            className="pipeline-alerts-fix"
                          >
                            Open in Pipeline
                          </Link>
                        )}
                        {idKey != null && (
                          <button
                            type="button"
                            className="pipeline-alerts-recheck"
                            onClick={() => recheckDealers([idKey])}
                            disabled={busy || busyAll}
                          >
                            {busy ? 'Checking…' : 'Re-check'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="ga4-count-scroll">
          <table className="ga4-count-table pipeline-alerts-table">
            <thead>
              <tr>
                <th className="ga4-count-sticky-col">Dealer</th>
                <th>Date</th>
                <th>Step</th>
                <th>Status</th>
                <th>Issue</th>
                <th>Rows</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="ga4-count-empty-row">
                    {!snapshot
                      ? '—'
                      : severity === 'resolved'
                        ? 'Fixed dealers are listed below.'
                        : 'No dealers match — every step passed for this filter.'}
                  </td>
                </tr>
              ) : (
                rows.map((a) => {
                  const idKey = a.dealerId != null ? String(a.dealerId) : null;
                  const busy = idKey != null && recheckingIds.has(idKey);
                  const checkedAt = idKey != null ? rechecked[idKey] : null;
                  return (
                  <tr key={`${a.dealerId}-${a.code}-${a.reportDate}`}>
                    <th className="ga4-count-sticky-col ga4-count-client" scope="row">
                      <span className="daily-sync-dealer-name">{a.dealerName}</span>
                      {a.clientId && <span className="daily-sync-client-id">{a.clientId}</span>}
                      {checkedAt && (
                        <span className="pipeline-alerts-rechecked">
                          Still failing · re-checked {formatDateTime(checkedAt)}
                        </span>
                      )}
                    </th>
                    <td>{a.reportDate || '—'}</td>
                    <td className="pipeline-alerts-step">{PIPELINE_STEP_LABELS[a.step]}</td>
                    <td>
                      <span className={`pipeline-alert-pill pipeline-alert-pill--${a.severity}`}>
                        {SEVERITY_LABELS[a.severity]}
                      </span>
                    </td>
                    <td className="pipeline-alerts-msg">{a.message}</td>
                    <td>
                      <CountsCell counts={a.counts} />
                    </td>
                    <td className="pipeline-alerts-actions">
                      <Link href={pipelineFixHref(a)} prefetch={false} className="pipeline-alerts-fix">
                        Open in Pipeline
                      </Link>
                      {idKey != null && (
                        <button
                          type="button"
                          className="pipeline-alerts-recheck"
                          onClick={() => recheckDealers([idKey])}
                          disabled={busy || busyAll}
                        >
                          {busy ? 'Checking…' : 'Re-check'}
                        </button>
                      )}
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>

          {(severity === 'resolved' || severity === 'all' || severity === 'active') &&
            resolvedRows.length > 0 && (
            <section className="pipeline-alerts-section">
              <h2 className="pipeline-tables-title">
                Fixed since the last full check ({resolvedRows.length})
              </h2>
              <table className="ga4-count-table pipeline-alerts-table">
                <thead>
                  <tr>
                    <th className="ga4-count-sticky-col">Dealer</th>
                    <th>Date</th>
                    <th>Step</th>
                    <th>Status</th>
                    <th>Was</th>
                    <th>Fixed at</th>
                  </tr>
                </thead>
                <tbody>
                  {resolvedRows.map((a) => (
                    <tr key={`resolved-${a.dealerId}-${a.code}-${a.reportDate}`}>
                      <th className="ga4-count-sticky-col ga4-count-client" scope="row">
                        <span className="daily-sync-dealer-name">{a.dealerName}</span>
                        {a.clientId && <span className="daily-sync-client-id">{a.clientId}</span>}
                      </th>
                      <td>{a.reportDate || '—'}</td>
                      <td className="pipeline-alerts-step">{PIPELINE_STEP_LABELS[a.step]}</td>
                      <td>
                        <span className="pipeline-alert-pill pipeline-alert-pill--resolved">Fixed</span>
                      </td>
                      <td className="pipeline-alerts-msg">{a.message}</td>
                      <td>
                        {formatDateTime(a.resolvedAt)}
                        {a.resolvedBy === 'pipeline' && (
                          <span className="daily-sync-client-id">auto, after Pipeline run</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {snapshot?.unmappedClients?.length > 0 && (
            <section className="pipeline-alerts-section">
              <h2 className="pipeline-tables-title">GA4 clients syncing without an active dealer</h2>
              <table className="ga4-count-table">
                <thead>
                  <tr>
                    <th>GA4 client ID</th>
                    <th>Days synced</th>
                    <th>Last date</th>
                    <th>Linked dealer</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.unmappedClients.map((u) => (
                    <tr key={u.clientId}>
                      <td>{u.clientId}</td>
                      <td>{u.days}</td>
                      <td>{u.lastDate}</td>
                      <td>{u.linkedDealer ? `${u.linkedDealer} (inactive)` : 'None — add or fix ga4_customer_id'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {snapshot?.cronFailures?.length > 0 && (
            <section className="pipeline-alerts-section">
              <h2 className="pipeline-tables-title">Cron job failures (last 24h)</h2>
              <table className="ga4-count-table">
                <thead>
                  <tr>
                    <th>Job</th>
                    <th>Started</th>
                    <th>Error</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.cronFailures.map((c) => (
                    <tr key={`${c.jobId}-${c.startedAt}`}>
                      <td>{c.jobName}</td>
                      <td>{formatDateTime(c.startedAt)}</td>
                      <td className="pipeline-alerts-msg">{c.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
