'use client';

import { useEffect, useMemo, useState } from 'react';
import { Panel, PanelBody, PanelHeader } from './Panel';
import { fetchMakeBreakdown } from '@/lib/api/dashboardApi';
import { useOverview } from './overview/OverviewDataContext';

const MAKE_COLORS = [
  '#34d399',
  '#60a5fa',
  '#a3e635',
  '#fb923c',
  '#f472b6',
  '#a78bfa',
  '#facc15',
  '#22d3ee',
  '#fb7185',
  '#94a3b8',
];
const OTHER_COLOR = '#9ca3af';

function colorForRank(rank) {
  const r = Number(rank) || 999;
  if (r === 999) return OTHER_COLOR;
  return MAKE_COLORS[Math.min(Math.max(r - 1, 0), MAKE_COLORS.length - 1)];
}

function normalizeRows(data) {
  const list = Array.isArray(data) ? data : data ? [data] : [];
  return list.map((row) => ({
    make_bucket: String(row.make_bucket ?? row.make ?? row.inv_make ?? 'Unknown'),
    views: Number(row.views ?? 0) || 0,
    pct: Number(row.pct ?? row.percentage ?? 0) || 0,
    rank: Number(row.rank ?? 999) || 999,
  }));
}

export default function MakeBreakdown({
  clientId: clientIdProp,
  from: fromProp,
  to: toProp,
  limit = null,
}) {
  const { tab, clientKey, from: ctxFrom, to: ctxTo } = useOverview();
  const clientId = clientIdProp ?? clientKey;
  const from = fromProp ?? ctxFrom;
  const to = toProp ?? ctxTo;

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [topN, setTopN] = useState(
    limit === 5 ? 5 : limit === 10 ? 10 : null
  );
  const [chartMode, setChartMode] = useState('pie');

  // VDP top tab only (id is lowercase `vdp` from PageTabs)
  const enabled = tab === 'vdp';

  useEffect(() => {
    if (!enabled) {
      setRows([]);
      setError(null);
      setLoading(false);
      return undefined;
    }
    if (!clientId || !from || !to) {
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchMakeBreakdown({
      clientId,
      from,
      to,
      limit: topN,
      onCancelCheck: () => cancelled,
    })
      .then((data) => {
        if (cancelled) return;
        if (data === undefined) return;
        setRows(normalizeRows(data));
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.message || 'Failed to load make breakdown.');
        setRows([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, clientId, from, to, topN, tab]);

  const total = useMemo(
    () => rows.reduce((sum, row) => sum + (Number(row.views) || 0), 0),
    [rows]
  );
  const chartData = useMemo(
    () =>
      rows.map((row) => ({
        ...row,
        color: colorForRank(row.rank),
      })),
    [rows]
  );
  const maxViews = useMemo(() => {
    const mx = chartData.length ? Math.max(...chartData.map((r) => r.views)) : 0;
    return mx > 0 ? mx : 1;
  }, [chartData]);

  if (!enabled) {
    return null;
  }

  return (
    <Panel className="make-breakdown-panel">
      <PanelHeader title="Make Breakdown" subtitle="VDP Views by Make">
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
            aria-label="Make breakdown limit"
          >
            <option value="all">All makes</option>
            <option value={5}>Top 5</option>
            <option value={10}>Top 10</option>
          </select>
        </div>
      </PanelHeader>

      <PanelBody>
        {loading && (
          <div className="make-breakdown-loading">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="make-breakdown-skel" />
            ))}
          </div>
        )}

        {!loading && error && (
          <div className="make-breakdown-error" role="alert">
            {error}
          </div>
        )}

        {!loading && !error && rows.length === 0 && (
          <div className="make-breakdown-empty">No make data for this period.</div>
        )}

        {!loading && !error && rows.length > 0 && (
          <div className="make-breakdown-content">
            <div className="make-breakdown-split">
              <div className="make-breakdown-chart-col">
                {chartMode === 'pie' ? (
                  <PieChart data={chartData} total={total} />
                ) : (
                  <MakeBarChart data={chartData} maxViews={maxViews} />
                )}
              </div>
              <div className="make-breakdown-table-side">
                <div className="make-breakdown-table-header">
                  <span>Make</span>
                  <span>Views</span>
                </div>
                <div className="make-breakdown-table-scroll">
                  {rows.map((row, index) => (
                    <div
                      key={`${row.rank}-${row.make_bucket}-${index}`}
                      className="make-breakdown-data-row"
                    >
                      <div className="make-breakdown-make-cell" title={row.make_bucket}>
                        <span
                          className="make-breakdown-dot"
                          style={{ backgroundColor: colorForRank(row.rank) }}
                        />
                        <span className="make-breakdown-name">{row.make_bucket}</span>
                      </div>
                      <span className="make-breakdown-views-cell">
                        {row.views.toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="make-breakdown-total">
                  <span>TOTAL</span>
                  <span className="make-breakdown-total-value">
                    {total.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </PanelBody>
    </Panel>
  );
}

function truncateLabel(label, max = 12) {
  if (!label || label.length <= max) return label;
  return `${label.slice(0, max - 1)}…`;
}

function MakeBarChart({ data, maxViews }) {
  return (
    <div className="make-breakdown-bars" aria-label="Make views bar chart">
      {data.map((row) => {
        const h = Math.max(4, Math.round((row.views / maxViews) * 200));
        return (
          <div key={`${row.rank}-${row.make_bucket}`} className="make-breakdown-bar-col">
            <div
              className="make-breakdown-bar-v"
              style={{ height: h, backgroundColor: row.color }}
            >
              <span className="make-breakdown-bar-tip">{row.views.toLocaleString()}</span>
            </div>
            <span className="make-breakdown-bar-label" title={row.make_bucket}>
              {truncateLabel(row.make_bucket)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function PieChart({ data, total }) {
  const size = 200;
  const stroke = 26;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="make-breakdown-pie">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--s3)"
          strokeWidth={stroke}
        />
        {data.map((row) => {
          const dash = ((Number(row.views) || 0) / Math.max(total, 1)) * circumference;
          if (dash <= 0) return null;
          const node = (
            <circle
              key={`${row.rank}-${row.make_bucket}`}
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
