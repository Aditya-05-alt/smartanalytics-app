import { Panel, PanelHeader, PanelBody } from '../Panel';

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
  pctDecimals,
}) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;

  const pctTotal = data.reduce((a, s) => a + (Number(s.pct) || 0), 0);
  const sliceTotal = data.reduce((a, s) => a + (Number(s.value) || 0), 0);
  const grandTotal =
    totalViews !== undefined && totalViews !== null
      ? Number(totalViews) || 0
      : sliceTotal;
  const isEmpty = pctTotal <= 0 && grandTotal <= 0;

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
                data.map((s) => {
                  const dash = ((Number(s.pct) || 0) / pctTotal) * circ;
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

          {/* ── Breakdown ── */}
          <div className="donut-lg-list">
            {data.map((s) => (
              <div key={s.name} className="donut-lg-row">
                <div
                  className="donut-lg-swatch"
                  style={{ background: s.color }}
                />
                <span className="donut-lg-name" title={s.fullName || s.name}>
                  {s.name}
                </span>
                <span className="donut-lg-value">
                  {(Number(s.value) || 0).toLocaleString()}
                </span>
                <span className="donut-lg-pct">
                  {pctDecimals != null
                    ? (Number(s.pct) || 0).toFixed(pctDecimals)
                    : Number(s.pct) || 0}
                  %
                </span>
              </div>
            ))}

            <div className="donut-lg-total">
              <span style={{ flex: 1 }}>{totalLabel}</span>
              <span style={{ fontWeight: 700, color: 'var(--t)' }}>
                {grandTotal.toLocaleString()}
              </span>
            </div>
          </div>
        </div>
        )}
      </PanelBody>
    </Panel>
  );
}
