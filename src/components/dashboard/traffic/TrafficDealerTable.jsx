'use client';

import { useEffect, useMemo, useState } from 'react';
import { Panel, PanelHeader, PanelBody } from '@/components/dashboard/Panel';
import FilterDropdown from '@/components/dashboard/FilterDropdown';
import CalendarRangePicker from '@/components/dashboard/CalendarRangePicker';
import Delta from '@/components/dashboard/Delta';
import { pctChange, previousMonthAlignedRange, periodMonthLabel } from '@/lib/overview/comparePeriod';
import { resolveDashboardDateRange } from '@/lib/dashboard/resolveDateRange';

const METRIC_COLS = [
  { key: 'vdp', label: 'VDP', decimals: 0 },
  { key: 'users', label: 'Users', decimals: 0 },
  { key: 'sessions', label: 'Sessions', decimals: 0 },
  { key: 'sessionsPerUser', label: 'Sessions / Users', decimals: 2 },
  { key: 'pagesPerSession', label: 'Pages / session', decimals: 2 },
  { key: 'viewsPerSession', label: 'Views / session', decimals: 2 },
];

const DEFAULT_RANGE = 'current_month';

/** "September 2026" → "Sep 2026"; omit year → "Sep". */
function shortMonthTag(from, to, { omitYear = false } = {}) {
  const full = periodMonthLabel(from, to);
  if (!full) return '';
  const match = String(full).trim().match(/^([A-Za-z]{3,9})\s+(\d{4})$/);
  if (!match) {
    return full.length > 10 ? `${full.slice(0, 10)}…` : full;
  }
  const mon = match[1].slice(0, 3);
  return omitYear ? mon : `${mon} ${match[2]}`;
}

function ComparePeriodSwitch({ enabled, onChange }) {
  return (
    <label className="compare-period-switch">
      <span className="compare-period-switch-label">Compare period</span>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        className={`compare-period-switch-track ${enabled ? 'compare-period-switch-track--on' : ''}`}
        onClick={onChange}
      >
        <span className="compare-period-switch-thumb" />
      </button>
    </label>
  );
}

function ChannelHeader({ name }) {
  const parts = String(name || '')
    .split(/\s*\+\s*/)
    .map((part) => part.trim())
    .filter(Boolean);

  return (
    <div className="adc-col-head" title={name}>
      <span className="adc-col-label">
        {parts.length <= 1 ? (
          name
        ) : (
          parts.map((part, index) => (
            <span key={`${part}-${index}`} className="adc-col-label-line">
              {part}
              {index < parts.length - 1 ? ' +' : ''}
            </span>
          ))
        )}
      </span>
    </div>
  );
}

function formatMetric(value, decimals = 0) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (decimals > 0) {
    return n.toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }
  return n.toLocaleString();
}

function MetricCell({
  value,
  compareValue,
  showCompare,
  decimals = 0,
  currentLabel = 'Current',
  compareLabel = 'Previous',
  deltaLabel = 'MoM',
}) {
  const cur = Number(value) || 0;
  const cmp = Number(compareValue) || 0;

  if (!showCompare) {
    if (cur <= 0) return <span className="adc-cell-empty">—</span>;
    return (
      <div className="adc-cell">
        <span className="adc-cell-views">{formatMetric(cur, decimals)}</span>
      </div>
    );
  }

  if (cur <= 0 && cmp <= 0) {
    return <span className="adc-cell-empty">—</span>;
  }

  return (
    <div className="adc-compare-stack">
      <div className="adc-compare-line">
        <span className="adc-compare-lbl" title={currentLabel}>
          {currentLabel}
        </span>
        <span className="adc-compare-num adc-compare-num--cur">
          {formatMetric(cur, decimals)}
        </span>
      </div>
      <div className="adc-compare-line">
        <span className="adc-compare-lbl" title={compareLabel}>
          {compareLabel}
        </span>
        <span className="adc-compare-num adc-compare-num--prev">
          {formatMetric(cmp, decimals)}
        </span>
      </div>
      <div className="adc-compare-line adc-compare-line--pct">
        <span className="adc-compare-lbl">{deltaLabel}</span>
        <span className="adc-compare-pct">
          <Delta value={pctChange(cur, cmp)} size={10} />
        </span>
      </div>
    </div>
  );
}

function ratio(numerator, denominator) {
  const den = Number(denominator) || 0;
  if (den <= 0) return 0;
  return Math.round(((Number(numerator) || 0) / den) * 100) / 100;
}

function channelMetrics(raw) {
  if (raw == null) return { sessions: 0, users: 0, pageViews: 0, vdp: 0 };
  if (typeof raw === 'number') {
    const n = Number(raw) || 0;
    return { sessions: 0, users: 0, pageViews: 0, vdp: n };
  }
  return {
    sessions: Number(raw.sessions) || 0,
    users: Number(raw.users) || 0,
    pageViews: Number(raw.pageViews) || 0,
    vdp: Number(raw.vdp) || 0,
  };
}

function channelVdpValue(raw) {
  if (raw == null) return 0;
  if (typeof raw === 'number') return Number(raw) || 0;
  return Number(raw.vdp) || 0;
}

function periodToRow(dealer, period, channelFilter = []) {
  if (!period) return null;
  const channelsIn = period.channels || {};
  const filterSet = channelFilter.length ? new Set(channelFilter) : null;

  const channelsOut = {};
  let users = 0;
  let sessions = 0;
  let pageViews = 0;
  let vdp = 0;

  for (const [name, raw] of Object.entries(channelsIn)) {
    if (filterSet && !filterSet.has(name)) continue;
    const m = channelMetrics(raw);
    channelsOut[name] = m.vdp;
    users += m.users;
    sessions += m.sessions;
    pageViews += m.pageViews;
    vdp += m.vdp;
  }

  if (!filterSet) {
    return {
      dealer,
      users: period.users,
      sessions: period.sessions,
      sessionsPerUser: period.sessionsPerUser,
      pagesPerSession: period.pagesPerSession,
      vdp: period.vdp,
      viewsPerSession: period.viewsPerSession,
      channels: channelsOut,
    };
  }

  return {
    dealer,
    users,
    sessions,
    sessionsPerUser: ratio(sessions, users),
    pagesPerSession: ratio(pageViews, sessions),
    vdp,
    viewsPerSession: ratio(vdp, sessions),
    channels: channelsOut,
  };
}

export default function TrafficDealerTable() {
  const [selectedDealers, setSelectedDealers] = useState([]);
  const [selectedChannels, setSelectedChannels] = useState([]);
  const [dateRange, setDateRange] = useState(DEFAULT_RANGE);
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [compareDateRange, setCompareDateRange] = useState(() => {
    const { from, to } = resolveDashboardDateRange(DEFAULT_RANGE);
    const prev = previousMonthAlignedRange(from, to);
    if (!prev?.compareFrom || !prev?.compareTo) return DEFAULT_RANGE;
    return {
      start: prev.compareFrom,
      end: prev.compareTo,
      preset: 'custom',
    };
  });
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const { from, to } = useMemo(
    () => resolveDashboardDateRange(dateRange),
    [dateRange]
  );
  const { from: compareFrom, to: compareTo } = useMemo(
    () => resolveDashboardDateRange(compareDateRange),
    [compareDateRange]
  );

  useEffect(() => {
    if (!from || !to) return undefined;
    const ctrl = new AbortController();
    const params = new URLSearchParams({ from, to });
    if (compareEnabled && compareFrom && compareTo) {
      params.set('compareFrom', compareFrom);
      params.set('compareTo', compareTo);
    }

    setLoading(true);
    setError(null);
    fetch(`/api/dashboard/traffic-dealer?${params.toString()}`, {
      signal: ctrl.signal,
    })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error || 'Failed to load traffic');
        return body;
      })
      .then((body) => {
        if (!ctrl.signal.aborted) setPayload(body);
      })
      .catch((err) => {
        if (ctrl.signal.aborted || err?.name === 'AbortError') return;
        setPayload(null);
        setError(err?.message || 'Failed to load traffic');
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });

    return () => ctrl.abort();
  }, [from, to, compareEnabled, compareFrom, compareTo]);

  const dealerRows = useMemo(() => {
    const list = payload?.dealers || [];
    return list
      .filter((dealer) =>
        !selectedDealers.length || selectedDealers.includes(dealer.name)
      )
      .map((dealer) => ({
        clientId: dealer.clientId,
        name: dealer.name,
        current: periodToRow(dealer.name, dealer.current, selectedChannels),
        compare: compareEnabled
          ? periodToRow(dealer.name, dealer.compare, selectedChannels)
          : null,
      }));
  }, [payload, selectedDealers, selectedChannels, compareEnabled]);

  const dealerOptions = useMemo(
    () => [
      { value: 'All', label: 'All Dealers' },
      ...(payload?.dealers || []).map((dealer) => ({
        value: dealer.name,
        label: dealer.name,
      })),
    ],
    [payload]
  );

  const allChannels = useMemo(() => {
    const order = payload?.channelOrder || [];
    const extra = new Set();
    for (const dealer of payload?.dealers || []) {
      for (const name of Object.keys(dealer.compare?.channels || {})) {
        if (!order.includes(name)) extra.add(name);
      }
    }
    return [...order, ...extra];
  }, [payload]);

  const channelOptions = useMemo(
    () => [
      { value: 'All', label: 'All Channels' },
      ...allChannels.map((name) => ({ value: name, label: name })),
    ],
    [allChannels]
  );

  const channelColumns = useMemo(() => {
    if (!selectedChannels.length) return allChannels;
    return allChannels.filter((name) => selectedChannels.includes(name));
  }, [allChannels, selectedChannels]);

  const sameYear =
    from && compareFrom && String(from).slice(0, 4) === String(compareFrom).slice(0, 4);

  const currentLabel = useMemo(
    () => shortMonthTag(from, to, { omitYear: sameYear }),
    [from, to, sameYear]
  );
  const compareLabel = useMemo(
    () => shortMonthTag(compareFrom, compareTo),
    [compareFrom, compareTo]
  );
  const deltaLabel =
    from && compareFrom && String(from).slice(0, 4) !== String(compareFrom).slice(0, 4)
      ? 'YoY'
      : 'MoM';

  const showCompare = compareEnabled;

  const cellCompareProps = {
    showCompare,
    currentLabel: currentLabel || 'Current',
    compareLabel: compareLabel || 'Previous',
    deltaLabel,
  };

  return (
    <>
      <div className="filters all-dealer-filters">
        <div className="all-dealer-filters-left">
          <FilterDropdown
            multi
            clearable
            options={dealerOptions}
            value={selectedDealers}
            onChange={setSelectedDealers}
          />
          <FilterDropdown
            multi
            clearable
            options={channelOptions}
            value={selectedChannels}
            onChange={setSelectedChannels}
          />
        </div>
        <div className="f-right all-dealer-filters-right">
          <ComparePeriodSwitch
            enabled={compareEnabled}
            onChange={() => setCompareEnabled((v) => !v)}
          />
          {compareEnabled && (
            <>
              <span className="f-label">Compare range</span>
              <CalendarRangePicker
                value={compareDateRange}
                onChange={setCompareDateRange}
              />
            </>
          )}
          <span className="f-label">Date range</span>
          <CalendarRangePicker value={dateRange} onChange={setDateRange} />
        </div>
      </div>

      <div className="content all-dealer-overview-content">
        <Panel className="all-dealer-channel-panel">
          <PanelHeader
            title="Traffic — Scout RV"
            badge={{
              label: 'Live data',
              bg: 'var(--s3)',
              color: 'var(--t2)',
            }}
          />
          <PanelBody className="all-dealer-channel-body">
            {error && (
              <div className="donut-err" role="alert">
                {error}
              </div>
            )}
            <div className={`adc-table-stage${loading ? ' adc-table-stage--busy' : ''}`}>
              <div className="adc-table-wrap">
                <table
                  className={`tbl adc-table traffic-table${
                    showCompare ? ' traffic-table--compare adc-table--compare' : ''
                  }`}
                >
                  <thead>
                    <tr>
                      <th className="adc-th-dealer traffic-th-freeze traffic-th-dealer">
                        Dealer name
                      </th>
                      {METRIC_COLS.map((col, index) => (
                        <th
                          key={col.key}
                          className={`adc-th-total traffic-th-freeze traffic-th-metric traffic-th-metric--${index}`}
                        >
                          {col.label}
                        </th>
                      ))}
                      {channelColumns.map((name) => (
                        <th key={name} className="adc-th-channel">
                          <ChannelHeader name={name} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {dealerRows.map((dealer) => (
                      <tr key={dealer.clientId}>
                        <td className="adc-td-dealer traffic-td-freeze traffic-td-dealer">
                          <span className="adc-dealer-name" title={dealer.name}>
                            {dealer.name}
                          </span>
                        </td>
                        {METRIC_COLS.map((col, index) => (
                          <td
                            key={col.key}
                            className={`adc-td-total traffic-td-freeze traffic-td-metric traffic-td-metric--${index}`}
                          >
                            <MetricCell
                              value={dealer.current?.[col.key]}
                              compareValue={dealer.compare?.[col.key]}
                              decimals={col.decimals}
                              {...cellCompareProps}
                            />
                          </td>
                        ))}
                        {channelColumns.map((colName) => (
                          <td
                            key={`${dealer.clientId}-${colName}`}
                            className="adc-td-channel"
                          >
                            <MetricCell
                              value={channelVdpValue(
                                dealer.current?.channels?.[colName]
                              )}
                              compareValue={channelVdpValue(
                                dealer.compare?.channels?.[colName]
                              )}
                              {...cellCompareProps}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {loading && (
                <div className="adc-table-overlay" role="status" aria-live="polite" aria-busy="true">
                  <div className="adc-table-loader">
                    <span className="adc-table-spinner" aria-hidden />
                    <span className="adc-table-loader-text">Loading Scout RV…</span>
                  </div>
                </div>
              )}
            </div>
          </PanelBody>
        </Panel>
      </div>
    </>
  );
}
