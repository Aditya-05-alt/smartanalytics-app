'use client';

import { useMemo, useState } from 'react';
import KpiCard from '../KpiCard';
import { useOverview } from './OverviewDataContext';

const TAB_LABELS = {
  all:   'All Pages',
  vdp:   'VDP',
  srp:   'SRP',
  home:  'Homepage',
  other: 'Other',
};

function fmt(n) {
  return Number(n || 0).toLocaleString();
}

function dayLabel(iso) {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso.slice(5);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: '2-digit',
    weekday: 'short',
  });
}

function compact(n) {
  return Intl.NumberFormat('en', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(Number(n || 0));
}

/** Y-axis labels (high → low); deduped so React keys stay unique when max is small. */
function buildYTicks(max) {
  const cap = Math.max(Number(max) || 0, 1);
  if (cap <= 4) {
    return Array.from({ length: cap + 1 }, (_, i) => cap - i);
  }
  const raw = [1, 0.75, 0.5, 0.25, 0].map((r) => Math.round(cap * r));
  const ticks = [];
  for (const v of raw) {
    if (ticks.length === 0 || ticks[ticks.length - 1] !== v) ticks.push(v);
  }
  return ticks;
}

function toLinePoints(data, max, width = 1000, height = 220) {
  if (!data.length) return '';
  if (data.length === 1) {
    const y = height - (data[0].value / max) * height;
    return `${(width / 2).toFixed(2)},${y.toFixed(2)}`;
  }
  return data
    .map((row, i) => {
      const x = (i / Math.max(data.length - 1, 1)) * width;
      const y = height - (row.value / max) * height;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
}

function toAreaPath(data, max, width = 1000, height = 220) {
  const points = toLinePoints(data, max, width, height);
  if (!points) return '';
  return `M0,${height} L${points.split(' ').join(' L')} L${width},${height} Z`;
}

function dayLabelShort(iso) {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso.slice(5);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

/** Full daily series — one bar/point per date in range. */
function buildDisplaySeries(dateList, series) {
  return (series || []).map((value, index) => ({
    date: dateList[index],
    value: Number(value) || 0,
  }));
}

const DENSE_CHART_DAY_THRESHOLD = 16;

export default function KpiRow() {
  const { tab, totals, loading, seriesByTab, dateList } = useOverview();
  const [chartMode, setChartMode] = useState('bar');
  const views = totals?.[tab] || 0;
  const viewsLabel = `${TAB_LABELS[tab] || 'Page'} Views`;
  const viewsDisplay = loading && !views ? '…' : fmt(views);
  const series = useMemo(() => seriesByTab?.[tab] || [], [seriesByTab, tab]);
  const displaySeries = useMemo(
    () => buildDisplaySeries(dateList, series),
    [dateList, series]
  );
  const isDenseChart = displaySeries.length >= DENSE_CHART_DAY_THRESHOLD;
  const isSingleDay = displaySeries.length === 1;
  const max = useMemo(() => {
    const mx = displaySeries.length ? Math.max(...displaySeries.map((d) => d.value)) : 0;
    return mx > 0 ? mx : 1;
  }, [displaySeries]);
  const yTicks = useMemo(() => buildYTicks(max), [max]);
  const barColors = ['#4f86f7', '#57cfa1', '#748ab2', '#f2be22', '#e8806f', '#8f7af6'];
  // const { uniqueVisitors } = useOverview();
  // const visitors = uniqueVisitors?.[tab] || 0;
  // const visitorsDisplay = loading && !visitors ? '…' : fmt(visitors);

  return (
    <div className="kpi-stack">
      <div className="kpi-row">
        {/* <KpiCard label="Unique Visitors" value={visitorsDisplay} mom={0} yoy={0} color="var(--green)" /> */}
        <KpiCard label={viewsLabel} value={viewsDisplay} mom={0} yoy={0} color="var(--acc)" />
      </div>

      <div className="kpi-inline-chart">
        <div className="kpi-inline-head">
          <div className="kpi-inline-title">{viewsLabel} by Date</div>
          <div className="chart-mode" role="group" aria-label="Chart type">
            <button
              type="button"
              className={`cm-btn ${chartMode === 'bar' ? 'active' : ''}`}
              onClick={() => setChartMode('bar')}
              aria-pressed={chartMode === 'bar'}
            >
              Bar
            </button>
            <button
              type="button"
              className={`cm-btn ${chartMode === 'line' ? 'active' : ''}`}
              onClick={() => setChartMode('line')}
              aria-pressed={chartMode === 'line'}
            >
              Line
            </button>
          </div>
        </div>
        <div className="kpi-big-chart">
          <div className="kpi-big-y">
            {yTicks.map((tick, i) => (
              <div key={`y-${i}-${tick}`} className="kpi-big-y-row">
                <span>{compact(tick)}</span>
              </div>
            ))}
          </div>

          <div className={`kpi-inline-plot ${isDenseChart ? 'kpi-inline-plot--dense' : ''}`}>
            {chartMode === 'bar' ? (
              <div
                className={[
                  'kpi-inline-bar-wrap',
                  isDenseChart ? 'kpi-inline-bar-wrap--dense' : '',
                  isSingleDay ? 'kpi-inline-bar-wrap--single' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={
                  isDenseChart && !isSingleDay
                    ? { minWidth: `${Math.max(displaySeries.length * 34, 100)}px` }
                    : undefined
                }
              >
                <div
                  className={[
                    'kpi-inline-bars',
                    isDenseChart ? 'kpi-inline-bars--dense' : '',
                    isSingleDay ? 'kpi-inline-bars--single' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {displaySeries.map((item, index) => {
                    const h = Math.max(2, Math.round((item.value / max) * 200));
                    return (
                      <div key={`${item.date || index}`} className="kpi-inline-col">
                        <div
                          className="kpi-inline-bar"
                          style={{ height: h, background: barColors[index % barColors.length] }}
                        >
                          <div className="kpi-inline-tip">{fmt(item.value)}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div
                  className={[
                    'kpi-inline-bar-dates',
                    isDenseChart ? 'kpi-inline-bar-dates--dense' : '',
                    isSingleDay ? 'kpi-inline-bar-dates--single' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {displaySeries.map((item, index) => (
                    <div
                      key={`date-${item.date || index}`}
                      className="kpi-inline-date"
                      title={dayLabel(item.date)}
                    >
                      {isDenseChart ? dayLabelShort(item.date) : dayLabel(item.date)}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="kpi-inline-line">
                <svg
                  width="100%"
                  height="220"
                  viewBox="0 0 1000 220"
                  preserveAspectRatio="none"
                  aria-label={`${viewsLabel} line chart`}
                >
                  <defs>
                    <linearGradient id="kpi-line-area" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#4f86f7" stopOpacity="0.35" />
                      <stop offset="100%" stopColor="#4f86f7" stopOpacity="0.05" />
                    </linearGradient>
                  </defs>
                  <path d={toAreaPath(displaySeries, max)} fill="url(#kpi-line-area)" />
                  <polyline
                    fill="none"
                    stroke="#4f86f7"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={toLinePoints(displaySeries, max)}
                  />
                </svg>
                <div
                  className={[
                    'kpi-inline-line-dates',
                    isDenseChart ? 'kpi-inline-line-dates--dense' : '',
                    isSingleDay ? 'kpi-inline-line-dates--single' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  style={
                    isSingleDay
                      ? undefined
                      : {
                          gridTemplateColumns: `repeat(${Math.max(displaySeries.length, 1)}, minmax(0, 1fr))`,
                        }
                  }
                >
                  {displaySeries.map((item, index) => (
                    <div key={`${item.date || index}`} className="kpi-inline-date" title={dayLabel(item.date)}>
                      {isDenseChart ? dayLabelShort(item.date) : dayLabel(item.date)}
                    </div>
                  ))}
                  </div>
                </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
