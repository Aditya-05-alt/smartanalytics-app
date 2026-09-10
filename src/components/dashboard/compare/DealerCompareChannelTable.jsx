'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Panel, PanelHeader } from '@/components/dashboard/Panel';
import Delta from '@/components/dashboard/Delta';
import ChannelGroupToggle from '@/components/dashboard/overview/ChannelGroupToggle';
import { colorForChannel } from '@/lib/ga4/channelDisplay';
import {
  applyChannelGroupsToComparisonRows,
  filterByExpandedGroups,
} from '@/lib/ga4/channelGroups';
import { useChannelGroupExpansion } from '@/hooks/useChannelGroupExpansion';
import {
  mergeChannelComparison,
  periodMonthLabel,
} from '@/lib/overview/comparePeriod';
import {
  isSelectionReady,
  resolveSelectionDealers,
  selectionKey,
  selectionLabel,
} from '@/lib/compare/compareSelection';
import { fetchCompareSideChannels } from '@/lib/compare/fetchCompareSideChannels';
import {
  channelBreakdownUsesGroups,
  selectedChannels,
} from '@/lib/vdp/vdpFilterParams';

/**
 * Channel comparison table.
 * Columns: Channel | Dealer | Compare with | Diff
 */
export default function DealerCompareChannelTable({
  leftSelection,
  rightSelection,
  dealers = [],
  from,
  to,
  pageTypeFilter = 'VDP',
  channelFilter = [],
  onLoadingChange,
}) {
  const [curRows, setCurRows] = useState([]);
  const [cmpRows, setCmpRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const { expanded, isExpanded, toggle } = useChannelGroupExpansion(false);

  const notifyLoading = useCallback(
    (busy) => {
      onLoadingChange?.(busy);
    },
    [onLoadingChange]
  );

  const leftDealers = useMemo(
    () =>
      resolveSelectionDealers(leftSelection, dealers, {
        pageType: pageTypeFilter,
      }),
    [leftSelection, dealers, pageTypeFilter]
  );
  const rightDealers = useMemo(
    () =>
      resolveSelectionDealers(rightSelection, dealers, {
        pageType: pageTypeFilter,
      }),
    [rightSelection, dealers, pageTypeFilter]
  );

  const dealerLabel = selectionLabel(leftSelection, dealers) || 'Dealer';
  const compareLabel = selectionLabel(rightSelection, dealers) || 'Compare with';
  const leftKey = selectionKey(leftSelection);
  const rightKey = selectionKey(rightSelection);
  const channelKey = useMemo(() => {
    const list = selectedChannels(channelFilter);
    return list.length ? [...list].sort().join('|') : '';
  }, [channelFilter]);
  const channels = useMemo(
    () => (channelKey ? channelKey.split('|') : []),
    [channelKey]
  );
  const dealersEpoch = useMemo(
    () =>
      (dealers || [])
        .map((d) => `${d.id}:${d.ga4CustomerId || ''}:${d.dealerCategory || ''}`)
        .sort()
        .join('|'),
    [dealers]
  );

  const periodLabel = useMemo(() => periodMonthLabel(from, to), [from, to]);

  const ready =
    isSelectionReady(leftSelection) &&
    isSelectionReady(rightSelection) &&
    leftDealers.length > 0 &&
    rightDealers.length > 0 &&
    Boolean(from && to);

  useEffect(() => {
    if (!ready) {
      setCurRows([]);
      setCmpRows([]);
      setLoading(false);
      notifyLoading(false);
      setError(null);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    notifyLoading(true);
    setError(null);

    const left = resolveSelectionDealers(leftSelection, dealers, {
      pageType: pageTypeFilter,
    });
    const right = resolveSelectionDealers(rightSelection, dealers, {
      pageType: pageTypeFilter,
    });

    const load = async () => {
      try {
        const [cur, cmp] = await Promise.all([
          fetchCompareSideChannels({
            dealers: left,
            from,
            to,
            pageTypeFilter,
            channelFilter: channels,
            onCancelCheck: () => cancelled,
          }),
          fetchCompareSideChannels({
            dealers: right,
            from,
            to,
            pageTypeFilter,
            channelFilter: channels,
            onCancelCheck: () => cancelled,
          }),
        ]);

        if (cancelled) return;
        setCurRows(cur || []);
        setCmpRows(cmp || []);
      } catch (err) {
        if (!cancelled) {
          setError(err?.message || 'Failed to load channel comparison');
          setCurRows([]);
          setCmpRows([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          notifyLoading(false);
        }
      }
    };

    load();
    return () => {
      cancelled = true;
      notifyLoading(false);
    };
  }, [
    ready,
    leftKey,
    rightKey,
    channelKey,
    dealersEpoch,
    leftSelection,
    rightSelection,
    dealers,
    from,
    to,
    pageTypeFilter,
    channels,
    notifyLoading,
  ]);

  const { rows, totals } = useMemo(
    () => mergeChannelComparison(curRows, cmpRows, null),
    [curRows, cmpRows]
  );

  const useChannelGroups = channelBreakdownUsesGroups(
    { channel: channels },
    pageTypeFilter === 'VDP' ? 'vdp' : 'all'
  );

  const groupedRows = useMemo(() => {
    if (!useChannelGroups) {
      return rows.map((r) => ({ ...r, rowKey: r.ch }));
    }
    return applyChannelGroupsToComparisonRows(rows);
  }, [rows, useChannelGroups]);

  const visibleRows = useMemo(() => {
    const filtered = filterByExpandedGroups(groupedRows, expanded);
    return filtered.map((r) => ({
      ...r,
      color: colorForChannel(r.ch),
    }));
  }, [groupedRows, expanded]);

  const showGroupColumn = useMemo(
    () => visibleRows.some((r) => r.isGroupRollup && r.collapsible),
    [visibleRows]
  );

  const onCopy = useCallback(() => {
    const lines = [['Channel', dealerLabel, compareLabel, 'Diff'].join('\t')];
    visibleRows.forEach((r) => {
      lines.push(
        [
          r.ch,
          r.cur,
          r.cmp,
          `${r.delta >= 0 ? '+' : ''}${r.delta}%`,
        ].join('\t')
      );
    });
    lines.push(
      [
        'Total',
        totals.cur,
        totals.cmp,
        `${totals.delta >= 0 ? '+' : ''}${totals.delta}%`,
      ].join('\t')
    );
    navigator.clipboard
      .writeText(lines.join('\n'))
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      })
      .catch(() => {});
  }, [visibleRows, totals, dealerLabel, compareLabel]);

  if (!isSelectionReady(leftSelection) || !isSelectionReady(rightSelection)) {
    return (
      <Panel className="cmp-table-panel">
        <PanelHeader title="Views by Channel — Dealer Comparison" />
        <div className="dealer-compare-empty">
          Select Dealer and Compare with (or a Category below).
        </div>
      </Panel>
    );
  }

  if (leftDealers.length === 0 || rightDealers.length === 0) {
    return (
      <Panel className="cmp-table-panel">
        <PanelHeader title="Views by Channel — Dealer Comparison" />
        <div className="dealer-compare-empty">
          No dealers with GA4 ids in one of the selections
          {leftSelection?.type === 'category'
            ? ` (check category tags in Admin → Dealers)`
            : ''}
          .
        </div>
      </Panel>
    );
  }

  const copyButton = (
    <button
      type="button"
      className={`copy-btn ${copied ? 'copied' : ''}`}
      onClick={onCopy}
      style={{ marginLeft: 'auto' }}
      disabled={loading || !!error}
    >
      {copied ? 'Copied!' : 'Copy table'}
    </button>
  );

  return (
    <Panel className="cmp-table-panel">
      <PanelHeader
        title={`${pageTypeFilter === 'VDP' ? 'VDP' : 'All Pages'} Views by Channel — Dealer Comparison`}
        badge={{ label: 'Copy-ready', bg: 'var(--acc-soft)', color: 'var(--acc)' }}
      >
        <span className="cmp-table-head-note">
          {`${periodLabel} · ${dealerLabel} · ${compareLabel} · Diff`}
        </span>
        {copyButton}
      </PanelHeader>

      {loading && (
        <div
          className="adc-nav-progress adc-nav-progress--table-top"
          role="progressbar"
          aria-label="Loading"
          aria-busy="true"
        >
          <div className="adc-nav-progress-bar" />
        </div>
      )}

      {error ? (
        <div className="cmp-table-error">{error}</div>
      ) : (
        <div className={`adc-table-stage dealer-compare-table-stage${loading ? ' adc-table-stage--busy' : ''}`}>
          <div className="cmp-table-wrap">
            <table className="cmp-tbl cmp-tbl--period-compare">
              <thead>
                <tr>
                  <th>Channel</th>
                  <th className="col-cur">{dealerLabel}</th>
                  <th className="col-prev">{compareLabel}</th>
                  <th className="col-mom">Diff</th>
                </tr>
              </thead>
              <tbody>
                {!loading && visibleRows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="cmp-table-loading">
                      No channel data for this range.
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
                      <td className="col-prev">{r.cmp.toLocaleString()}</td>
                      <td className="col-mom">
                        <Delta value={r.delta} />
                      </td>
                    </tr>
                  ))
                )}
                {visibleRows.length > 0 && (
                  <tr className="cmp-tbl-total-row">
                    <td>Total {pageTypeFilter === 'VDP' ? 'VDP' : ''}</td>
                    <td className="col-cur">{totals.cur.toLocaleString()}</td>
                    <td className="col-prev">{totals.cmp.toLocaleString()}</td>
                    <td className="col-mom">
                      <Delta value={totals.delta} />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {loading && (
            <div className="adc-table-overlay" role="status" aria-live="polite" aria-busy="true">
              <div className="adc-table-loader">
                <span className="adc-table-spinner" aria-hidden />
                <span className="adc-table-loader-text">Loading…</span>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="cmp-table-foot">
        <div className="cmp-legend-swatch cmp-legend-swatch--cur" />
        {dealerLabel}
        <div className="cmp-legend-swatch cmp-legend-swatch--prev" />
        {compareLabel}
        <span className="cmp-table-foot-note">
          {`Diff: ${dealerLabel} vs ${compareLabel}`}
        </span>
      </div>
    </Panel>
  );
}
