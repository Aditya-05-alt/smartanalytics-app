'use client';

import { useEffect, useMemo, useState } from 'react';
import { Panel, PanelBody, PanelHeader } from './Panel';
import { fetchTopCampaigns } from '@/lib/api/dashboardApi';
import { useOverview } from './overview/OverviewDataContext';

const TAB_TO_CAMPAIGN_FILTER = {
  all: 'ALL',
  srp: 'SRP',
  home: 'Home',
  other: 'Other',
};

const CAMPAIGN_ENABLED_TABS = new Set(['all', 'srp', 'home', 'other']);

const CAMPAIGN_COLORS = [
  '#4f86f7',
  '#57cfa1',
  '#f2be22',
  '#e8806f',
  '#8f7af6',
  '#34d399',
  '#60a5fa',
  '#fb923c',
  '#f472b6',
  '#94a3b8',
];

function colorForRank(rank) {
  const r = Number(rank) || 1;
  return CAMPAIGN_COLORS[Math.min(Math.max(r - 1, 0), CAMPAIGN_COLORS.length - 1)];
}

function normalizeRows(data) {
  const list = Array.isArray(data) ? data : data ? [data] : [];
  return list.map((row) => ({
    campaign: String(row.campaign ?? '(not set)'),
    source: String(row.source ?? ''),
    medium: String(row.medium ?? ''),
    channel: String(row.channel ?? ''),
    views: Number(row.views ?? 0) || 0,
    sessions: Number(row.sessions ?? 0) || 0,
    total_users: Number(row.total_users ?? 0) || 0,
    new_users: Number(row.new_users ?? 0) || 0,
    pct: Number(row.pct ?? 0) || 0,
    rank: Number(row.rank ?? 999) || 999,
  }));
}

export default function TopCampaigns({
  clientId: clientIdProp,
  from: fromProp,
  to: toProp,
  limit = 10,
}) {
  const { tab, clientKey, from: ctxFrom, to: ctxTo } = useOverview();
  const clientId = clientIdProp ?? clientKey;
  const from = fromProp ?? ctxFrom;
  const to = toProp ?? ctxTo;

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const enabled = CAMPAIGN_ENABLED_TABS.has(tab);
  const pageTypeFilter = TAB_TO_CAMPAIGN_FILTER[tab] || 'ALL';

  const tabLabel = useMemo(() => {
    const labels = {
      all: 'All Pages',
      srp: 'SRP',
      home: 'Homepage',
      other: 'Other',
    };
    return labels[tab] || 'Page';
  }, [tab]);

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

    fetchTopCampaigns({
      clientId,
      from,
      to,
      pageTypeFilter,
      limit,
      onCancelCheck: () => cancelled,
    })
      .then((data) => {
        if (cancelled) return;
        if (data === undefined) return;
        setRows(normalizeRows(data));
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.message || 'Failed to load top campaigns.');
        setRows([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, clientId, from, to, pageTypeFilter, limit, tab]);

  const total = useMemo(
    () => rows.reduce((sum, row) => sum + row.views, 0),
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

  if (!enabled) {
    return null;
  }

  return (
    <Panel className="make-breakdown-panel top-campaigns-panel">
      <PanelHeader title="Top Campaigns" subtitle={`Top ${limit} by ${tabLabel} Views`} />

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
          <div className="make-breakdown-empty">No campaign data for this period.</div>
        )}

        {!loading && !error && rows.length > 0 && (
          <div className="make-breakdown-content">
            <div className="make-breakdown-split">
              <div className="make-breakdown-chart-col">
                <CampaignPieChart data={chartData} total={total} />
              </div>
              <div className="make-breakdown-table-side">
                <div className="make-breakdown-table-header">
                  <span>Campaign</span>
                  <span>Views</span>
                </div>
                <div className="make-breakdown-table-scroll">
                  {rows.map((row, index) => (
                    <div
                      key={`${row.rank}-${row.campaign}-${index}`}
                      className="make-breakdown-data-row"
                    >
                      <div className="make-breakdown-make-cell" title={row.campaign}>
                        <span
                          className="make-breakdown-dot"
                          style={{ backgroundColor: colorForRank(row.rank) }}
                        />
                        <span className="make-breakdown-name">{row.campaign}</span>
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

function CampaignPieChart({ data, total }) {
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
        aria-label="Top campaigns by views"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--s3)"
          strokeWidth={stroke}
        />
        {data.map((row) => {
          const dash = (row.views / Math.max(total, 1)) * circumference;
          if (dash <= 0) return null;
          const node = (
            <circle
              key={`${row.rank}-${row.campaign}`}
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
        <div className="make-breakdown-center-label">Views</div>
      </div>
    </div>
  );
}
