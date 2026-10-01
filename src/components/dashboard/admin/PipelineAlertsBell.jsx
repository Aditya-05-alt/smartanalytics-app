'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PIPELINE_ALERTS_EVENT,
  PIPELINE_STEP_LABELS,
  fetchPipelineAlerts,
  groupAlertsByDealer,
  pipelineFixHref,
  subscribeRemotePipelineAlerts,
} from '@/lib/api/adminPipelineAlerts';

const POLL_MS = 5 * 60 * 1000;
export { PIPELINE_ALERTS_EVENT };

function timeAgo(iso) {
  if (!iso) return '';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export default function PipelineAlertsBell() {
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  const load = useCallback(async () => {
    try {
      setSnapshot(await fetchPipelineAlerts());
      setError(null);
    } catch (e) {
      setError(e?.message || 'Failed to load alerts.');
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, POLL_MS);
    const onUpdated = (e) => {
      if (e.detail) setSnapshot(e.detail);
    };
    window.addEventListener(PIPELINE_ALERTS_EVENT, onUpdated);
    const unsubscribe = subscribeRemotePipelineAlerts(load);
    return () => {
      clearInterval(timer);
      window.removeEventListener(PIPELINE_ALERTS_EVENT, onUpdated);
      unsubscribe();
    };
  }, [load]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const groups = useMemo(
    () =>
      groupAlertsByDealer(
        (snapshot?.alerts || []).filter((a) => a.severity !== 'pending')
      ),
    [snapshot]
  );

  const errorCount = snapshot?.counts?.error ?? 0;
  const warningCount = snapshot?.counts?.warning ?? 0;
  const pendingCount = snapshot?.counts?.pending ?? 0;
  const badge = errorCount + warningCount;
  const badgeTone = errorCount > 0 ? 'error' : warningCount > 0 ? 'warning' : null;

  return (
    <div className="pipeline-bell" ref={wrapRef}>
      <button
        type="button"
        className={`pipeline-bell-btn ${badgeTone ? `pipeline-bell-btn--${badgeTone}` : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-label={`Pipeline alerts${badge ? `: ${badge}` : ''}`}
        aria-expanded={open}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path
            fill="currentColor"
            d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2Z"
          />
        </svg>
        {badge > 0 && (
          <span className={`pipeline-bell-count pipeline-bell-count--${badgeTone}`}>
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </button>

      {open && (
        <div className="pipeline-bell-panel" role="dialog" aria-label="Pipeline alerts">
          <div className="pipeline-bell-head">
            <span className="pipeline-bell-title">Pipeline alerts</span>
            {snapshot && (
              <span className="pipeline-bell-sub">
                {snapshot.from} → {snapshot.to} · checked {timeAgo(snapshot.generatedAt)}
                {snapshot.dealers?.length > 0 &&
                  ` · ${snapshot.dealers.filter((d) => d.status === 'success').length}/${snapshot.dealers.length} OK`}
              </span>
            )}
          </div>

          <div className="pipeline-bell-body">
            {error && <p className="pipeline-bell-empty ga4-count-error-text">{error}</p>}
            {!error && !snapshot && <p className="pipeline-bell-empty">No check has run yet.</p>}
            {!error && snapshot && groups.length === 0 && (
              <p className="pipeline-bell-empty pipeline-bell-empty--ok">
                All {snapshot.dealers?.length ? `${snapshot.dealers.length} ` : ''}dealers passed every
                step.
                {pendingCount > 0 && ` ${pendingCount} day(s) still settling in GA4.`}
              </p>
            )}
            {groups.map((g) => (
              <div key={g.dealerId ?? g.dealerName} className="pipeline-bell-dealer">
                <div className="pipeline-bell-dealer-row">
                  <span className={`pipeline-alert-dot pipeline-alert-dot--${g.severity}`} />
                  <span className="pipeline-bell-dealer-name">{g.dealerName}</span>
                </div>
                {g.items.map((a) => (
                  <Link
                    key={`${a.code}-${a.reportDate}`}
                    href={pipelineFixHref(a)}
                    prefetch={false}
                    className="pipeline-bell-item"
                    onClick={() => setOpen(false)}
                    title={a.message}
                  >
                    <span className="pipeline-bell-step">{PIPELINE_STEP_LABELS[a.step]}</span>
                    <span className="pipeline-bell-date">{a.reportDate || '—'}</span>
                  </Link>
                ))}
              </div>
            ))}
            {!error && snapshot && (snapshot.unmappedClients?.length > 0 || snapshot.cronFailures?.length > 0) && (
              <p className="pipeline-bell-extra">
                {snapshot.unmappedClients.length > 0 &&
                  `${snapshot.unmappedClients.length} GA4 client(s) syncing without a dealer. `}
                {snapshot.cronFailures.length > 0 &&
                  `${snapshot.cronFailures.length} cron job failure(s) in 24h.`}
              </p>
            )}
          </div>

          <div className="pipeline-bell-foot">
            <Link
              href="/dashboard/admin/alerts"
              prefetch={false}
              className="pipeline-bell-all"
              onClick={() => setOpen(false)}
            >
              View all alerts
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
