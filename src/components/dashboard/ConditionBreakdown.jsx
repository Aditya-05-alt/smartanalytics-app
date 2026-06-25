'use client';

import { useMemo, useState } from 'react';
import { Panel, PanelBody, PanelHeader } from './Panel';
import CompareBreakdownSection from './CompareBreakdownSection';
import { fetchConditionBreakdown } from '@/lib/api/dashboardApi';
import { useOverview } from './overview/OverviewDataContext';
import { useBreakdownFetch } from '@/hooks/useBreakdownFetch';

const CONDITION_COLOR_MAP = {
  New: '#34d399',
  Used: '#60a5fa',
  Unknown: '#9ca3af',
};
const FALLBACK_COLORS = ['#fb923c', '#f472b6', '#a78bfa', '#facc15', '#22d3ee'];
const OTHER_COLOR = '#9ca3af';

function colorForRow(row, index) {
  if (Number(row.rank) === 999) return OTHER_COLOR;
  if (CONDITION_COLOR_MAP[row.condition_bucket]) {
    return CONDITION_COLOR_MAP[row.condition_bucket];
  }
  return FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

function normalizeRows(data) {
  const list = Array.isArray(data) ? data : data ? [data] : [];
  return list.map((row) => ({
    condition_bucket: String(row.condition_bucket ?? row.inv_condition ?? 'Unknown').trim() || 'Unknown',
    views: Number(row.views ?? 0) || 0,
    pct: Number(row.pct ?? row.percentage ?? 0) || 0,
    rank: Number(row.rank ?? 999) || 999,
  }));
}

function ConditionBreakdownControls({ chartMode, setChartMode, topN, setTopN }) {
  return (
    <div className="make-breakdown-head-controls">
      <div className="chart-mode" role="group" aria-label="Chart type">
        <button
          type="button"
          className={`cm-btn ${chartMode === 'pie' ? 'active' : ''}`}
          onClick={() => setChartMode('pie')}
          aria-pressed={chartMode === 'pie'}
        >
          Pie
        </button>
        <button
          type="button"
          className={`cm-btn ${chartMode === 'bar' ? 'active' : ''}`}
          onClick={() => setChartMode('bar')}
          aria-pressed={chartMode === 'bar'}
        >
          Bar
        </button>
      </div>
      <select
        className="make-breakdown-select"
        value={topN ?? 'all'}
        onChange={(e) => {
          const value = e.target.value;
          setTopN(value === 'all' ? null : Number(value));
        }}
        aria-label="Condition breakdown limit"
      >
        <option value="all">All conditions</option>
        <option value="5">Top 5</option>
        <option value="10">Top 10</option>
      </select>
    </div>
  );
}

function ConditionBreakdownBody({ rows, loading, error, chartMode, emptyMessage }) {
  const total = useMemo(
    () => rows.reduce((sum, row) => sum + (Number(row.views) || 0), 0),
    [rows]
  );
  const chartData = useMemo(
    () =>
      rows.map((row, index) => ({
        ...row,
        color: colorForRow(row, index),
      })),
    [rows]
  );
  const maxViews = useMemo(() => {
    const mx = chartData.length ? Math.max(...chartData.map((r) => r.views)) : 0;
    return mx > 0 ? mx : 1;
  }, [chartData]);

  if (loading && rows.length === 0) {
    return (
      <div className="make-breakdown-loading">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="make-breakdown-skel" />
        ))}
      </div>
    );
  }

  if (!loading && error) {
    return (
      <div className="make-breakdown-error" role="alert">
        {error}
      </div>
    );
  }

  if (!loading && !error && rows.length === 0) {
    return <div className="make-breakdown-empty">{emptyMessage}</div>;
  }

  if (error || rows.length === 0) return null;

  return (
    <div className="make-breakdown-content">
      <div className="make-breakdown-split year-breakdown-split">
        <div className="make-breakdown-chart-col">
          {chartMode === 'pie' ? (
            <ConditionPieChart data={chartData} total={total} />
          ) : (
            <ConditionBarChart data={chartData} maxViews={maxViews} />
          )}
        </div>
        <div className="make-breakdown-table-side">
          <div className="make-breakdown-table-header">
            <span>Condition</span>
            <span>Views</span>
          </div>
          <div className="make-breakdown-table-scroll">
            {rows.map((row, index) => (
              <div
                key={`${row.rank}-${row.condition_bucket}-${index}`}
                className="make-breakdown-data-row"
              >
                <div className="make-breakdown-make-cell" title={row.condition_bucket}>
                  <span
                    className="make-breakdown-dot"
                    style={{ backgroundColor: colorForRow(row, index) }}
                  />
                  <span className="make-breakdown-name">{row.condition_bucket}</span>
                </div>
                <span className="make-breakdown-views-cell">
                  {row.views.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
          <div className="make-breakdown-total">
            <span>TOTAL</span>
            <span className="make-breakdown-total-value">{total.toLocaleString()}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConditionBreakdownPane({
  periodLabel,
  clientId,
  from,
  to,
  topN,
  vdpFilters,
  tab,
  chartMode,
  enabled,
}) {
  const { rows, loading, error } = useBreakdownFetch({
    enabled,
    clientId,
    from,
    to,
    topN,
    vdpFilters,
    tab,
    fetchFn: fetchConditionBreakdown,
    normalize: normalizeRows,
    errorMessage: 'Failed to load condition breakdown.',
  });

  return (
    <Panel className="make-breakdown-panel make-breakdown-panel--compare">
      <PanelHeader title={periodLabel} />
      <PanelBody>
        <ConditionBreakdownBody
          rows={rows}
          loading={loading}
          error={error}
          chartMode={chartMode}
          emptyMessage="No condition data for this period."
        />
      </PanelBody>
    </Panel>
  );
}

export default function ConditionBreakdown({
  clientId: clientIdProp,
  from: fromProp,
  to: toProp,
  limit = null,
}) {
  const {
    tab,
    vdpFilters,
    clientKey,
    from: ctxFrom,
    to: ctxTo,
    compareEnabled,
    compareFrom,
    compareTo,
    currentPeriodLabel,
    comparePeriodLabel,
  } = useOverview();

  const clientId = clientIdProp ?? clientKey;
  const from = fromProp ?? ctxFrom;
  const to = toProp ?? ctxTo;

  const [topN, setTopN] = useState(limit);
  const [chartMode, setChartMode] = useState('pie');

  const enabled = tab === 'vdp';
  const showCompare = enabled && compareEnabled && compareFrom && compareTo;

  const singleFetch = useBreakdownFetch({
    enabled: enabled && !showCompare,
    clientId,
    from,
    to,
    topN,
    vdpFilters,
    tab,
    fetchFn: fetchConditionBreakdown,
    normalize: normalizeRows,
    errorMessage: 'Failed to load condition breakdown.',
  });

  if (!enabled) return null;

  const controls = (
    <ConditionBreakdownControls
      chartMode={chartMode}
      setChartMode={setChartMode}
      topN={topN}
      setTopN={setTopN}
    />
  );

  if (showCompare) {
    return (
      <CompareBreakdownSection title="Condition Breakdown" headerExtra={controls}>
        <ConditionBreakdownPane
          periodLabel={comparePeriodLabel}
          clientId={clientId}
          from={compareFrom}
          to={compareTo}
          topN={topN}
          vdpFilters={vdpFilters}
          tab={tab}
          chartMode={chartMode}
          enabled={enabled}
        />
        <ConditionBreakdownPane
          periodLabel={currentPeriodLabel}
          clientId={clientId}
          from={from}
          to={to}
          topN={topN}
          vdpFilters={vdpFilters}
          tab={tab}
          chartMode={chartMode}
          enabled={enabled}
        />
      </CompareBreakdownSection>
    );
  }

  return (
    <Panel className="make-breakdown-panel condition-breakdown-panel">
      <PanelHeader title="Condition Breakdown" subtitle="VDP Views by Condition">
        {controls}
      </PanelHeader>
      <PanelBody>
        <ConditionBreakdownBody
          rows={singleFetch.rows}
          loading={singleFetch.loading}
          error={singleFetch.error}
          chartMode={chartMode}
          emptyMessage="No condition data for this period."
        />
      </PanelBody>
    </Panel>
  );
}

function truncateLabel(label, max = 12) {
  if (!label || label.length <= max) return label;
  return `${label.slice(0, max - 1)}…`;
}

function ConditionBarChart({ data, maxViews }) {
  return (
    <div className="make-breakdown-bars" aria-label="Condition views bar chart">
      {data.map((row, index) => {
        const h = Math.max(4, Math.round((row.views / maxViews) * 200));
        return (
          <div
            key={`${row.rank}-${row.condition_bucket}-${index}`}
            className="make-breakdown-bar-col"
          >
            <div
              className="make-breakdown-bar-v"
              style={{ height: h, backgroundColor: row.color }}
            >
              <span className="make-breakdown-bar-tip">{row.views.toLocaleString()}</span>
            </div>
            <span className="make-breakdown-bar-label" title={row.condition_bucket}>
              {truncateLabel(row.condition_bucket)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ConditionPieChart({ data, total }) {
  const size = 200;
  const stroke = 26;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="make-breakdown-pie">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ transform: 'rotate(-90deg)' }}
        aria-label="Condition views pie chart"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--s3)"
          strokeWidth={stroke}
        />
        {data.map((row, index) => {
          const dash = (row.views / Math.max(total, 1)) * circumference;
          if (dash <= 0) return null;
          const node = (
            <circle
              key={`${row.rank}-${row.condition_bucket}-${index}`}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={row.color}
              strokeWidth={stroke}
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-offset}
            />
          );
          offset += dash;
          return node;
        })}
      </svg>
      <div className="make-breakdown-center">
        <div className="make-breakdown-center-value">{total.toLocaleString()}</div>
        <div className="make-breakdown-center-label">VDP Views</div>
      </div>
    </div>
  );
}
