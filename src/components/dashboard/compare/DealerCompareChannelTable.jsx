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
 * Total VDP expands to per-dealer totals (channel rows unchanged).
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
  const [leftDealerTotals, setLeftDealerTotals] = useState([]);
  const [rightDealerTotals, setRightDealerTotals] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadPct, setLoadPct] = useState(0);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const { expanded, isExpanded, toggle } = useChannelGroupExpansion(false);
  /** Total VDP → dealer-wise totals under the total row. */
  const [totalExpanded, setTotalExpanded] = useState(false);

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
      setLeftDealerTotals([]);
      setRightDealerTotals([]);
      setLoading(false);
      setLoadPct(0);
      notifyLoading(false);
      setError(null);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    setLoadPct(0);
    notifyLoading(true);
    setError(null);

    const left = resolveSelectionDealers(leftSelection, dealers, {
      pageType: pageTypeFilter,
    });
    const right = resolveSelectionDealers(rightSelection, dealers, {
      pageType: pageTypeFilter,
    });

    const sideProg = {
      left: { completed: 0, total: 1 },
      right: { completed: 0, total: 1 },
    };
    const emitProgress = () => {
      if (cancelled) return;
      const completed =
        (Number(sideProg.left.completed) || 0) +
        (Number(sideProg.right.completed) || 0);
      const total = Math.max(
        1,
        (Number(sideProg.left.total) || 1) + (Number(sideProg.right.total) || 1)
      );
      const pct = Math.min(99, Math.round((completed / total) * 100));
      setLoadPct(pct);
    };

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
            onProgress: (p) => {
              sideProg.left = {
                completed: p?.completed ?? 0,
                total: Math.max(1, p?.total ?? 1),
              };
              emitProgress();
            },
          }),
          fetchCompareSideChannels({
            dealers: right,
            from,
            to,
            pageTypeFilter,
            channelFilter: channels,
            onCancelCheck: () => cancelled,
            onProgress: (p) => {
              sideProg.right = {
                completed: p?.completed ?? 0,
                total: Math.max(1, p?.total ?? 1),
              };
              emitProgress();
            },
          }),
        ]);

        if (cancelled) return;
        setLoadPct(100);
        setCurRows(cur?.channels || []);
        setCmpRows(cmp?.channels || []);
        setLeftDealerTotals(cur?.dealerTotals || []);
        setRightDealerTotals(cmp?.dealerTotals || []);
      } catch (err) {
        if (!cancelled) {
          setError(err?.message || 'Failed to load channel comparison');
          setCurRows([]);
          setCmpRows([]);
          setLeftDealerTotals([]);
          setRightDealerTotals([]);
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

  /** Per-side dealer lists for the Total VDP expand row (one line / column). */
  const leftBreakdownDealers = useMemo(() => {
    return [...(leftDealerTotals || [])]
      .map((d) => ({
        dealerId: String(d.dealerId),
        name: d.name || 'Dealer',
        total: Number(d.total) || 0,
      }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  }, [leftDealerTotals]);

  const rightBreakdownDealers = useMemo(() => {
    return [...(rightDealerTotals || [])]
      .map((d) => ({
        dealerId: String(d.dealerId),
        name: d.name || 'Dealer',
        total: Number(d.total) || 0,
      }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  }, [rightDealerTotals]);

  const canExpandTotal =
    leftBreakdownDealers.length > 0 || rightBreakdownDealers.length > 0;
  const showToggleCol = showGroupColumn || canExpandTotal;
  const totalLabel = pageTypeFilter === 'VDP' ? 'Total VDP' : 'Total';

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
        totalLabel,
        totals.cur,
        totals.cmp,
        `${totals.delta >= 0 ? '+' : ''}${totals.delta}%`,
      ].join('\t')
    );
    if (totalExpanded && canExpandTotal) {
      const leftTxt = leftBreakdownDealers
        .map((d) => `${d.name}: ${d.total}`)
        .join(' | ');
      const rightTxt = rightBreakdownDealers
        .map((d) => `${d.name}: ${d.total}`)
        .join(' | ');
      lines.push(['Dealers', leftTxt, rightTxt, ''].join('\t'));
    }
    navigator.clipboard
      .writeText(lines.join('\n'))
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      })
      .catch(() => {});
  }, [
    visibleRows,
    totals,
    dealerLabel,
    compareLabel,
    totalLabel,
    totalExpanded,
    canExpandTotal,
    leftBreakdownDealers,
    rightBreakdownDealers,
  ]);

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

  const renderDealerStack = (list) => {
    if (!list.length) return <span className="cmp-tbl-na">—</span>;
    return (
      <div className="cmp-dealer-total-stack">
        {list.map((d) => (
          <div key={d.dealerId} className="cmp-dealer-total-line">
            <span className="cmp-dealer-total-name" title={d.name}>
              {d.name}
            </span>
            <span className="cmp-dealer-total-val">
              {d.total.toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    );
  };

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
                          {showToggleCol && (
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
                  <tr className="cmp-tbl-total-row cmp-tbl-row--group-rollup">
                    <td>
                      <div className="cmp-channel-cell">
                        {canExpandTotal ? (
                          <ChannelGroupToggle
                            expanded={totalExpanded}
                            onToggle={() => setTotalExpanded((v) => !v)}
                            label={totalLabel}
                          />
                        ) : showToggleCol ? (
                          <span className="cmp-channel-toggle-spacer" aria-hidden />
                        ) : null}
                        <span>{totalLabel}</span>
                      </div>
                    </td>
                    <td className="col-cur">{totals.cur.toLocaleString()}</td>
                    <td className="col-prev">{totals.cmp.toLocaleString()}</td>
                    <td className="col-mom">
                      <Delta value={totals.delta} />
                    </td>
                  </tr>
                )}
                {totalExpanded && canExpandTotal && (
                  <tr className="cmp-tbl-row--group-member cmp-tbl-row--total-member">
                    <td>
                      <div className="cmp-channel-cell cmp-channel-cell--member">
                        {showToggleCol ? (
                          <span className="cmp-channel-toggle-spacer" aria-hidden />
                        ) : null}
                        <span className="cmp-dealer-total-label">Dealers</span>
                      </div>
                    </td>
                    <td className="col-cur">{renderDealerStack(leftBreakdownDealers)}</td>
                    <td className="col-prev">{renderDealerStack(rightBreakdownDealers)}</td>
                    <td className="col-mom">
                      <span className="cmp-tbl-na">—</span>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {loading && (
            <div className="adc-table-overlay" role="status" aria-live="polite" aria-busy="true">
              <div className="adc-table-loader dealer-compare-loader">
                <span className="adc-table-spinner" aria-hidden />
                <span className="adc-table-loader-text">
                  Loading {loadPct}%
                </span>
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
