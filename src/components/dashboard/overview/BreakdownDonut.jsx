'use client';

import { useMemo } from 'react';
import { Panel, PanelHeader, PanelBody } from '../Panel';
import Delta from '../Delta';
import ChannelGroupToggle from './ChannelGroupToggle';
import { filterByExpandedGroups } from '@/lib/ga4/channelGroups';
import { useChannelGroupExpansion } from '@/hooks/useChannelGroupExpansion';

/**
 * Reusable donut + breakdown list panel.
 *
 * Fully data-driven — pass `data` and it'll auto-render the donut and the
 * breakdown list. Handles the zero/empty state gracefully.
 *
 * Props
 *   title         — panel header title
 *   badge         — { label, bg, color } chip on the panel header
 *   data          — [{ name, color, value, pct }, ...]
 *   centerValue   — (optional) big number in the donut hole. If omitted,
 *                   computed from data.value sum (compact-formatted).
 *   centerLabel   — small caps label below it (e.g. "VDP VIEWS")
 *   totalLabel    — caption for the total row at the bottom of the list
 *   size, stroke  — donut sizing (defaults sized for a 50% column)
 */

const COMPACT = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

function DonutSkeleton({ size = 200, rowCount = 5 }) {
  return (
    <div className="donut-lg-wrap donut-skeleton">
      <div
        className="donut-skel-ring"
        style={{ width: size, height: size, flexShrink: 0 }}
        aria-hidden
      />
      <div className="donut-lg-list" style={{ flex: 1 }}>
        {Array.from({ length: rowCount }, (_, i) => (
          <div key={i} className="donut-skel-row" aria-hidden />
        ))}
        <div className="donut-skel-total" aria-hidden />
      </div>
    </div>
  );
}

export default function BreakdownDonut({
  title,
  badge,
  data = [],
  /** Donut slices only (defaults to `data`). List always uses `data`. */
  chartData,
  centerValue,
  centerLabel = '',
  totalLabel = 'Total',
  size = 200,
  stroke = 24,
  loading = false,
  error = null,
  headerExtra = null,
  totalViews,
  disabled = false,
  disabledMessage = 'VDP data only',
  disabledSubtext = '',
  emptyMessage = null,
  skeletonRows = 5,
  pctDecimals = 2,
  listScrollable = false,
  /** % change vs compare period — shown on the right (green up / red down). */
  totalDelta = null,
}) {
  const { expanded, isExpanded, toggle } = useChannelGroupExpansion(false);
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;

  const listSeries = data;
  const visibleListSeries = useMemo(
    () => filterByExpandedGroups(listSeries, expanded),
    [listSeries, expanded]
  );
  const showGroupColumn = useMemo(
    () => listSeries.some((s) => s.isGroupRollup && s.collapsible),
    [listSeries]
  );
  const donutSeries = chartData ?? data;
  const sliceTotal = listSeries.reduce((a, s) => a + (Number(s.value) || 0), 0);
  const donutTotal = donutSeries.reduce((a, s) => a + (Number(s.value) || 0), 0);
  const grandTotal =
    totalViews !== undefined && totalViews !== null
      ? Number(totalViews) || 0
      : sliceTotal;
  const isEmpty = donutTotal <= 0 && grandTotal <= 0;

  const center =
    centerValue !== undefined
      ? centerValue
      : grandTotal > 0
      ? COMPACT.format(grandTotal)
      : '0';

  let offset = 0;

  return (
    <Panel>
      <PanelHeader title={title} badge={badge}>
        {headerExtra}
      </PanelHeader>
      {error && (
        <div className="donut-err" role="alert">
          {error}
        </div>
      )}
      <PanelBody style={{ padding: '1.5rem 1.5rem' }}>
        {disabled ? (
          <div className="donut-disabled">
            <div className="donut-disabled-title">{disabledMessage}</div>
            {disabledSubtext && (
              <div className="donut-disabled-sub">{disabledSubtext}</div>
            )}
          </div>
        ) : loading ? (
          <DonutSkeleton size={size} rowCount={skeletonRows} />
        ) : emptyMessage ? (
          <div className="donut-empty-msg">{emptyMessage}</div>
        ) : (
        <div className="donut-lg-wrap">
          {/* ── Donut ── */}
          <div
            style={{
              position: 'relative',
              width: size,
              height: size,
              flexShrink: 0,
            }}
          >
            <svg
              width={size}
              height={size}
              viewBox={`0 0 ${size} ${size}`}
              style={{ transform: 'rotate(-90deg)' }}
            >
              {/* faint track */}
              <circle
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke="var(--s3)"
                strokeWidth={stroke}
              />
              {!isEmpty &&
                donutSeries.map((s) => {
                  const dash =
                    (Number(s.value) / Math.max(donutTotal, 1)) * circ;
                  if (dash <= 0) return null;
                  const node = (
                    <circle
                      key={s.name}
                      cx={size / 2}
                      cy={size / 2}
                      r={r}
                      fill="none"
                      stroke={s.color}
                      strokeWidth={stroke}
                      strokeLinecap="butt"
                      strokeDasharray={`${dash} ${circ - dash}`}
                      strokeDashoffset={-offset}
                    />
                  );
                  offset += dash;
                  return node;
                })}
            </svg>

            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                pointerEvents: 'none',
              }}
            >
              <div
                className="font-display"
                style={{
                  fontSize: 38,
                  fontWeight: 700,
                  color: 'var(--t)',
                  lineHeight: 1,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {center}
              </div>
              {centerLabel && (
                <div
                  style={{
                    fontSize: 10,
                    color: 'var(--t3)',
                    textTransform: 'uppercase',
                    letterSpacing: '.08em',
                    marginTop: 5,
                    fontWeight: 600,
                  }}
                >
                  {centerLabel}
                </div>
              )}
            </div>
          </div>

          {/* ── Breakdown (rows scroll; total stays fixed when listScrollable) ── */}
          <div
            className={`donut-lg-list-col${listScrollable ? ' donut-lg-list-col--scroll' : ''}${totalDelta != null ? ' donut-lg-list-col--compare' : ''}`}
          >
            {totalDelta != null && (
              <div className="donut-lg-list-header" aria-hidden>
                <span className="donut-lg-list-header-spacer" />
                <span className="donut-lg-list-header-delta">Δ vs left</span>
              </div>
            )}
            <div
              className={
                listScrollable
                  ? 'donut-lg-list-rows donut-lg-list--scroll'
                  : 'donut-lg-list-rows'
              }
            >
              {visibleListSeries.map((s) => (
                <div
                  key={`${s.groupKey || 'solo'}-${s.name}`}
                  className={[
                    'donut-lg-row',
                    s.delta != null ? 'donut-lg-row--compare' : '',
                    s.isGroupRollup ? 'donut-lg-row--group-rollup' : '',
                    s.isGroupMember ? 'donut-lg-row--group-member' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {showGroupColumn && (
                    s.isGroupRollup && s.collapsible ? (
                      <ChannelGroupToggle
                        expanded={isExpanded(s.groupKey)}
                        onToggle={() => toggle(s.groupKey)}
                        label={s.name}
                      />
                    ) : (
                      <span className="donut-lg-toggle-spacer" aria-hidden />
                    )
                  )}
                  <div
                    className="donut-lg-swatch"
                    style={{ background: s.color }}
                  />
                  <span
                    className={`donut-lg-name${s.isGroupMember ? ' donut-lg-name--member' : ''}`}
                    title={s.fullName || s.name}
                  >
                    {s.name}
                  </span>
                  <span className="donut-lg-value">
                    {(Number(s.value) || 0).toLocaleString()}
                  </span>
                  <span className="donut-lg-pct">
                    {(Number(s.pct) || 0).toFixed(pctDecimals)}%
                  </span>
                  {s.delta != null && (
                    <span className="donut-lg-delta">
                      <Delta value={s.delta} size={10} />
                    </span>
                  )}
                </div>
              ))}
            </div>

            <div
              className={`donut-lg-total donut-lg-total--fixed${totalDelta != null ? ' donut-lg-total--compare' : ''}`}
            >
              <span className="donut-lg-total-label">{totalLabel}</span>
              <span className="donut-lg-total-value">
                {grandTotal.toLocaleString()}
              </span>
              {totalDelta != null && (
                <span className="donut-lg-total-delta">
                  <Delta value={totalDelta} size={11} />
                </span>
              )}
            </div>
          </div>
        </div>
        )}
      </PanelBody>
    </Panel>
  );
}
