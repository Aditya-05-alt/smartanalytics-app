'use client';

import { useEffect, useMemo, useState } from 'react';
import ChartTopNSelect from '@/components/dashboard/ChartTopNSelect';
import { Panel, PanelBody, PanelHeader } from './Panel';
import { fetchTopCampaignsBundle } from '@/lib/api/topCampaignsFetch';
import {
  getTopCampaignsCache,
  hasTopCampaignsCache,
} from '@/lib/data/topCampaignsCache';
import { vdpFilterCacheSuffix } from '@/lib/vdp/vdpFilterParams';
import { useOverview } from './overview/OverviewDataContext';

const TAB_TO_CAMPAIGN_FILTER = {
  all: 'ALL',
  vdp: 'VDP',
  srp: 'SRP',
  home: 'Home',
  other: 'Other',
};

const ALL_PAGE_TYPE_FILTERS = ['ALL', 'VDP', 'SRP', 'Home', 'Other'];

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
  return list.map((row, index) => ({
    campaign: String(row.campaign ?? '(not set)'),
    source: String(row.source ?? ''),
    medium: String(row.medium ?? ''),
    channel: String(row.channel ?? ''),
    views: Number(row.views ?? 0) || 0,
    sessions: Number(row.sessions ?? 0) || 0,
    total_users: Number(row.total_users ?? 0) || 0,
    new_users: Number(row.new_users ?? 0) || 0,
    pct: Number(row.pct ?? 0) || 0,
    rank: Number(row.rank ?? index + 1) || index + 1,
  }));
}

export default function TopCampaigns({
  clientId: clientIdProp,
  from: fromProp,
  to: toProp,
}) {
  const { tab, vdpFilters, clientKey, from: ctxFrom, to: ctxTo } = useOverview();
  const clientId = clientIdProp ?? clientKey;
  const from = fromProp ?? ctxFrom;
  const to = toProp ?? ctxTo;

  const pageTypeFilter = TAB_TO_CAMPAIGN_FILTER[tab] || 'ALL';
  const filterCacheSuffix = vdpFilterCacheSuffix(vdpFilters, tab);
  const [chartTopN, setChartTopN] = useState(null);
  const [rows, setRows] = useState(() =>
    clientId && from && to
      ? normalizeRows(
          getTopCampaignsCache(
            clientId,
            from,
            to,
            pageTypeFilter,
            filterCacheSuffix
          ) || []
        )
      : []
  );
  const [loading, setLoading] = useState(
    () =>
      Boolean(
        clientId &&
          from &&
          to &&
          !hasTopCampaignsCache(
            clientId,
            from,
            to,
            pageTypeFilter,
            filterCacheSuffix
          )
      )
  );
  const [error, setError] = useState(null);

  const tabLabel = useMemo(() => {
    const labels = {
      all: 'All Pages',
      vdp: 'VDP',
      srp: 'SRP',
      home: 'Homepage',
      other: 'Other',
    };
    return labels[tab] || 'Page';
  }, [tab]);

  useEffect(() => {
    if (!clientId || !from || !to) return undefined;

    let cancelled = false;
    const pending = ALL_PAGE_TYPE_FILTERS.filter(
      (f) => !hasTopCampaignsCache(clientId, from, to, f)
    );
    let next = 0;
    const concurrency = 2;

    async function worker() {
      while (next < pending.length) {
        if (cancelled) return;
        const filter = pending[next];
        next += 1;
        try {
          await fetchTopCampaignsBundle({
            clientId,
            from,
            to,
            pageTypeFilter: filter,
            vdpFilters,
            tab,
            onCancelCheck: () => cancelled,
          });
        } catch {
          /* prefetch */
        }
      }
    }

    Promise.all(
      Array.from({ length: Math.min(concurrency, pending.length) }, () => worker())
    );

    return () => {
      cancelled = true;
    };
  }, [clientId, from, to, vdpFilters, tab]);

  useEffect(() => {
    if (!clientId || !from || !to) {
      setRows([]);
      setLoading(false);
      return undefined;
    }

    const cached = getTopCampaignsCache(
      clientId,
      from,
      to,
      pageTypeFilter,
      filterCacheSuffix
    );
    if (cached) {
      setRows(normalizeRows(cached));
      setLoading(false);
      setError(null);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchTopCampaignsBundle({
      clientId,
      from,
      to,
      pageTypeFilter,
      vdpFilters,
      tab,
      onCancelCheck: () => cancelled,
    })
      .then((data) => {
        if (cancelled || data === undefined) return;
        setRows(normalizeRows(data));
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.message || 'Failed to load campaigns.');
        setRows([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [clientId, from, to, pageTypeFilter, vdpFilters, tab, filterCacheSuffix]);

  const allRows = rows;
  const displayRows = useMemo(() => {
    if (chartTopN == null) return allRows;
    return allRows.slice(0, chartTopN);
  }, [allRows, chartTopN]);

  const displayTotal = useMemo(
    () => displayRows.reduce((sum, row) => sum + row.views, 0),
    [displayRows]
  );

  const chartData = useMemo(
    () =>
      displayRows.map((row) => ({
        ...row,
        color: colorForRank(row.rank),
      })),
    [displayRows]
  );

  return (
    <Panel className="make-breakdown-panel top-campaigns-panel">
      <PanelHeader
        title="Campaign Breakdown"
        subtitle={
          chartTopN == null
            ? `${tabLabel} · ${allRows.length} campaign(s)`
            : `${tabLabel} · Top ${chartTopN} of ${allRows.length} campaign(s)`
        }
      >
        <div className="make-breakdown-head-controls">
          <ChartTopNSelect
            value={chartTopN}
            onChange={setChartTopN}
            ariaLabel="Campaign chart limit"
          />
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

        {!loading && !error && allRows.length === 0 && (
          <div className="make-breakdown-empty">No campaign data for this period.</div>
        )}

        {!loading && !error && allRows.length > 0 && (
          <div className="make-breakdown-content">
            <div className="make-breakdown-split">
              <div className="make-breakdown-chart-col">
                <CampaignPieChart data={chartData} total={displayTotal} />
              </div>
              <div className="make-breakdown-table-side">
                <div className="make-breakdown-table-header">
                  <span>Campaign</span>
                  <span>Views</span>
                </div>
                <div className="make-breakdown-table-scroll">
                  {displayRows.map((row, index) => (
                    <div
                      key={`${row.rank}-${row.campaign}-${row.source}-${index}`}
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
                        <span className="make-breakdown-pct-inline">
                          {row.pct.toFixed(2)}%
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
                <div className="make-breakdown-total">
                  <span>TOTAL</span>
                  <span className="make-breakdown-total-value">
                    {displayTotal.toLocaleString()}
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
        <div className="make-breakdown-center-label">Chart views</div>
      </div>
    </div>
  );
}
