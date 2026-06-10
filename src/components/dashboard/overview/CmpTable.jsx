'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { Panel, PanelHeader } from '../Panel';
import Delta from '../Delta';
import ChannelGroupToggle from './ChannelGroupToggle';
import { useOverview } from './OverviewDataContext';
import { fetchChannelBreakdownBundle } from '@/lib/api/channelBreakdownFetch';
import { colorForChannel } from '@/lib/ga4/channelDisplay';
import {
  applyChannelGroupsToComparisonRows,
  filterByExpandedGroups,
} from '@/lib/ga4/channelGroups';
import { useChannelGroupExpansion } from '@/hooks/useChannelGroupExpansion';
import { vdpFilterCacheSuffix } from '@/lib/vdp/vdpFilterParams';
import {
  mergeChannelComparison,
  sameMonthLastYearLabel,
} from '@/lib/overview/comparePeriod';

const TAB_TO_PAGE_TYPE = {
  all: 'ALL',
  vdp: 'VDP',
  srp: 'SRP',
  home: 'Home',
  other: 'Other',
};

const TAB_TITLES = {
  all: 'All Pages',
  vdp: 'VDP',
  srp: 'SRP',
  home: 'Homepage',
  other: 'Other',
};

const VISIBLE_TABS = new Set(['all', 'vdp']);

export default function CmpTable() {
  const {
    tab,
    clientKey,
    from,
    to,
    compareFrom,
    compareTo,
    currentPeriodLabel,
    comparePeriodLabel,
    vdpFilters,
    beginBreakdownLoad,
    endBreakdownLoad,
  } = useOverview();

  const [curRows, setCurRows] = useState([]);
  const [cmpRows, setCmpRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const { expanded, isExpanded, toggle } = useChannelGroupExpansion(true);

  const pageTypeFilter = TAB_TO_PAGE_TYPE[tab] || 'ALL';
  const filterCacheSuffix = vdpFilterCacheSuffix(vdpFilters, tab);
  const viewsLabel = tab === 'vdp' ? 'VDP Views' : 'Views';
  const panelTitle = `${TAB_TITLES[tab] || 'Page'} Views by Channel — Period Comparison`;
  const lyPeriodLabel = useMemo(
    () => sameMonthLastYearLabel(from, to),
    [from, to]
  );

  useEffect(() => {
    if (
      !VISIBLE_TABS.has(tab)
      || !clientKey
      || !from
      || !to
      || !compareFrom
      || !compareTo
    ) {
      setCurRows([]);
      setCmpRows([]);
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    let loadTracked = false;
    setLoading(true);
    setError(null);
    beginBreakdownLoad();
    loadTracked = true;

    Promise.all([
      fetchChannelBreakdownBundle({
        clientId: clientKey,
        from,
        to,
        pageTypeFilter,
        vdpFilters,
        tab,
        onCancelCheck: () => cancelled,
      }),
      fetchChannelBreakdownBundle({
        clientId: clientKey,
        from: compareFrom,
        to: compareTo,
        pageTypeFilter,
        vdpFilters,
        tab,
        onCancelCheck: () => cancelled,
      }),
    ])
      .then(([current, compare]) => {
        if (cancelled) return;
        setCurRows(current || []);
        setCmpRows(compare || []);
      })
      .catch((fetchError) => {
        if (cancelled) return;
        setError(fetchError?.message || 'Failed to load comparison data.');
        setCurRows([]);
        setCmpRows([]);
      })
      .finally(() => {
        if (loadTracked) endBreakdownLoad();
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    tab,
    clientKey,
    from,
    to,
    compareFrom,
    compareTo,
    pageTypeFilter,
    vdpFilters,
    filterCacheSuffix,
    beginBreakdownLoad,
    endBreakdownLoad,
  ]);

  const { rows, totals } = useMemo(
    () => mergeChannelComparison(curRows, cmpRows),
    [curRows, cmpRows]
  );

  const rowsWithColors = useMemo(() => {
    const colored = rows.map((r, i) => ({ ...r, color: colorForChannel(r.ch, i) }));
    return applyChannelGroupsToComparisonRows(colored);
  }, [rows]);

  const visibleRows = useMemo(
    () => filterByExpandedGroups(rowsWithColors, expanded),
    [rowsWithColors, expanded]
  );

  const showGroupColumn = useMemo(
    () => rowsWithColors.some((r) => r.isGroupRollup && r.collapsible),
    [rowsWithColors]
  );

  const onCopy = useCallback(() => {
    const lines = [
      [
        'Channel',
        `Current ${viewsLabel}`,
        'MoM Δ',
        `Previous ${viewsLabel}`,
        'YoY Δ',
        `Last Year ${viewsLabel}`,
        'YoY % vs Cur',
      ].join('\t'),
    ];
    rowsWithColors.forEach((r) => {
      lines.push(
        [
          r.ch,
          r.cur,
          `${r.delta >= 0 ? '+' : ''}${r.delta}%`,
          r.cmp,
          '0%',
          0,
          '0%',
        ].join('\t')
      );
    });
    lines.push(
      [
        'Total',
        totals.cur,
        `${totals.delta >= 0 ? '+' : ''}${totals.delta}%`,
        totals.cmp,
        '0%',
        0,
        '0%',
      ].join('\t')
    );
    navigator.clipboard
      .writeText(lines.join('\n'))
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      })
      .catch(() => {});
  }, [rowsWithColors, totals, viewsLabel]);

  if (!VISIBLE_TABS.has(tab)) return null;

  return (
    <Panel className="cmp-table-panel">
      <PanelHeader
        title={panelTitle}
        badge={{ label: 'Copy-ready', bg: 'var(--acc-soft)', color: 'var(--acc)' }}
      >
        <span className="cmp-table-head-note">
          Current vs Previous vs Same Month Last Year
        </span>
        <button
          type="button"
          className={`copy-btn ${copied ? 'copied' : ''}`}
          onClick={onCopy}
          style={{ marginLeft: 'auto' }}
          disabled={loading || !!error}
        >
          {copied ? (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Copied!
            </>
          ) : (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              Copy table
            </>
          )}
        </button>
      </PanelHeader>

      {error ? (
        <div className="cmp-table-error">{error}</div>
      ) : (
        <div className="cmp-table-wrap">
          <table className="cmp-tbl cmp-tbl--period-compare">
            <thead>
              <tr>
                <th rowSpan={2}>Channel</th>
                <th colSpan={2} className="col-cur">
                  Current — {currentPeriodLabel}
                </th>
                <th colSpan={2} className="col-prev">
                  Previous — {comparePeriodLabel}
                </th>
                <th colSpan={2} className="col-lyear">
                  Same Month Last Year — {lyPeriodLabel}
                </th>
              </tr>
              <tr>
                <th className="col-cur">{viewsLabel}</th>
                <th className="col-cur">MoM Δ</th>
                <th className="col-prev">{viewsLabel}</th>
                <th className="col-prev">YoY Δ</th>
                <th className="col-lyear">{viewsLabel}</th>
                <th className="col-lyear">YoY % vs Cur</th>
              </tr>
            </thead>
            <tbody>
              {loading && visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="cmp-table-loading">
                    Loading channel comparison…
                  </td>
                </tr>
              ) : (
                visibleRows.map((r) => (
                  <tr
                    key={r.rowKey || r.ch}
                    className={
                      r.isGroupRollup
                        ? 'cmp-tbl-row--group-rollup'
                        : r.isGroupMember
                        ? 'cmp-tbl-row--group-member'
                        : undefined
                    }
                  >
                    <td>
                      <div
                        className={`cmp-channel-cell${r.isGroupMember ? ' cmp-channel-cell--member' : ''}`}
                      >
                        {showGroupColumn && (
                          r.isGroupRollup && r.collapsible ? (
                            <ChannelGroupToggle
                              expanded={isExpanded(r.groupKey)}
                              onToggle={() => toggle(r.groupKey)}
                              label={r.ch}
                            />
                          ) : (
                            <span className="cmp-channel-toggle-spacer" aria-hidden />
                          )
                        )}
                        <div
                          className="cmp-channel-dot"
                          style={{ background: r.color }}
                        />
                        <span>{r.ch}</span>
                      </div>
                    </td>
                    <td className="col-cur">{r.cur.toLocaleString()}</td>
                    <td className="col-cur">
                      <Delta value={r.delta} />
                    </td>
                    <td className="col-prev">{r.cmp.toLocaleString()}</td>
                    <td className="col-prev">
                      <Delta value={0} />
                    </td>
                    <td className="col-lyear">0</td>
                    <td className="col-lyear">
                      <Delta value={0} />
                    </td>
                  </tr>
                ))
              )}
              {!loading && visibleRows.length > 0 && (
                <tr className="cmp-tbl-total-row">
                  <td>Total {tab === 'vdp' ? 'VDP' : ''}</td>
                  <td className="col-cur">{totals.cur.toLocaleString()}</td>
                  <td className="col-cur">
                    <Delta value={totals.delta} />
                  </td>
                  <td className="col-prev">{totals.cmp.toLocaleString()}</td>
                  <td className="col-prev">
                    <Delta value={0} />
                  </td>
                  <td className="col-lyear">0</td>
                  <td className="col-lyear">
                    <Delta value={0} />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="cmp-table-foot">
        <div className="cmp-legend-swatch cmp-legend-swatch--cur" />
        Current period
        <div className="cmp-legend-swatch cmp-legend-swatch--prev" />
        Previous period
        <div className="cmp-legend-swatch cmp-legend-swatch--lyear" />
        Last year same month
        <span className="cmp-table-foot-note">
          MoM compares current vs previous · YoY coming soon
        </span>
      </div>
    </Panel>
  );
}
