'use client';

import { useState } from 'react';
import { fmt, monthTick, signed } from '@/lib/wheelerPump/calc';
import { cx } from './ui';

const SERIES = [['pin', 'var(--in)'], ['pout', 'var(--out)'], ['local', 'var(--local)']];

export function Legend() {
  return (
    <div className={cx('legend')}>
      {[['Local sales', 'var(--local)'], ['Pumped in', 'var(--in)'], ['Pumped out', 'var(--out)']].map(([label, color]) => (
        <span key={label}><i style={{ background: color }} />{label}</span>
      ))}
    </div>
  );
}

function TipBox({ tip }) {
  if (!tip) return null;
  const left = Math.min(tip.x + 12, window.innerWidth - 270);
  const top = Math.min(tip.y + 12, window.innerHeight - 90);
  return (
    <div className={cx('tip')} style={{ left, top }}>
      {tip.lines.map((line, i) => <div key={i}>{line}</div>)}
    </div>
  );
}

const BARS = [['local', 'Local sales', 'var(--local)'], ['pin', 'Pumped in', 'var(--in)'], ['pout', 'Pumped out', 'var(--out)']];

/**
 * One period has no trend to draw, so each figure is a level line across the months the period
 * covers (from `s.span`, shown on a month axis), labelled at the end.
 */
function SnapshotLines({ s, W, H, caption }) {
  const months = s.span && s.span[1] > s.span[0] ? s.span[1] - s.span[0] + 1 : 0;
  const m = { l: 34, r: 112, t: 14, b: (caption ? 30 : 14) + (months ? 16 : 0) };
  const tickStep = Math.max(1, Math.ceil(months / 7));
  const max = Math.max(4, s.local, s.pin, s.pout);
  const step = 10 ** Math.floor(Math.log10(max));
  const nice = Math.ceil(max / (step / 2)) * (step / 2);
  const y = (v) => H - m.b - (v / nice) * (H - m.t - m.b);
  // Keep end labels apart when two values are close.
  const labels = BARS.map(([k, label, color]) => ({ k, label, color, ly: y(s[k]) })).sort((a, b) => a.ly - b.ly);
  for (let i = 1; i < labels.length; i += 1) labels[i].ly = Math.max(labels[i].ly, labels[i - 1].ly + 13);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Local sales, pumped in and pumped out${caption ? ` for ${caption}` : ''}`}>
      {[0, 1, 2, 3, 4].map((i) => {
        const v = (nice * i) / 4;
        return (
          <g key={i}>
            <line x1={m.l} x2={W - m.r} y1={y(v)} y2={y(v)} stroke="var(--line-soft)" />
            <text x={m.l - 6} y={y(v) + 4} textAnchor="end">{fmt(v)}</text>
          </g>
        );
      })}
      {BARS.map(([k, , color]) => (
        <g key={k}>
          <line x1={m.l} x2={W - m.r} y1={y(s[k])} y2={y(s[k])} stroke={color} strokeWidth={2.4} strokeLinecap="round" />
          <circle cx={W - m.r} cy={y(s[k])} r={4} fill={color} />
        </g>
      ))}
      {labels.map((l) => (
        <text key={l.k} x={W - m.r + 9} y={l.ly + 4} fill={l.color} fontWeight={600}>
          {`${l.label} ${fmt(s[l.k])}`}
        </text>
      ))}
      {Array.from({ length: months }, (_, i) => {
        const x = m.l + (i * (W - m.l - m.r)) / Math.max(1, months - 1);
        const labelled = i % tickStep === 0 || i === months - 1;
        return (
          <g key={i}>
            <line x1={x} x2={x} y1={y(0)} y2={y(0) + 4} stroke="var(--line)" />
            {labelled && <text x={x} y={y(0) + 16} textAnchor="middle">{monthTick(s.span[0] + i)}</text>}
          </g>
        );
      })}
      {caption && <text x={(m.l + W - m.r) / 2} y={H - 8} textAnchor="middle" fontWeight={600}>{caption}</text>}
    </svg>
  );
}

/**
 * Range by range: each period is a segment spanning its own months (`span`) at its value, so the
 * chart shows which date range had which figures. Dashed links join one range to the next.
 */
function RangeChart({ series, selected, onPick }) {
  const [tip, setTip] = useState(null);
  const W = 640;
  const H = 250;
  const m = { l: 34, r: 118, t: 14, b: 48 };
  const t0 = series[0].span[0];
  const t1 = series[series.length - 1].span[1] + 1;
  const xm = (t) => m.l + ((t - t0) * (W - m.l - m.r)) / Math.max(1, t1 - t0);
  const max = Math.max(4, ...series.flatMap((s) => [s.local, s.pin, s.pout]));
  const step = 10 ** Math.floor(Math.log10(max));
  const nice = Math.ceil(max / (step / 2)) * (step / 2);
  const y = (v) => H - m.b - (v / nice) * (H - m.t - m.b);
  const months = t1 - t0;
  const tickStep = Math.max(1, Math.ceil(months / 8));
  const last = series[series.length - 1];
  const ends = BARS.map(([k, label, color]) => ({ k, label, color, ly: y(last[k]) })).sort((a, b) => a.ly - b.ly);
  for (let i = 1; i < ends.length; i += 1) ends[i].ly = Math.max(ends[i].ly, ends[i - 1].ly + 13);
  const isSel = (s) => (s.key ?? s.label) === selected;
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Local sales, pumped in and pumped out by date range">
        {[0, 1, 2, 3, 4].map((i) => {
          const v = (nice * i) / 4;
          return (
            <g key={i}>
              <line x1={m.l} x2={W - m.r} y1={y(v)} y2={y(v)} stroke="var(--line-soft)" />
              <text x={m.l - 6} y={y(v) + 4} textAnchor="end">{fmt(v)}</text>
            </g>
          );
        })}
        {series.map((s) => (
          <g key={`band${s.key ?? s.label}`}>
            {isSel(s) && series.length > 1 && (
              <rect x={xm(s.span[0])} y={m.t} width={xm(s.span[1] + 1) - xm(s.span[0])} height={H - m.t - m.b} fill="var(--accent-soft)" rx={4} />
            )}
            <line x1={xm(s.span[0]) + 1} x2={xm(s.span[1] + 1) - 1} y1={y(0) + 22} y2={y(0) + 22} stroke="var(--line)" strokeWidth={3} strokeLinecap="round" />
            <text x={(xm(s.span[0]) + xm(s.span[1] + 1)) / 2} y={y(0) + 36} textAnchor="middle" fontWeight={isSel(s) ? 600 : undefined} fill={isSel(s) ? 'var(--fg)' : undefined}>
              {xm(s.span[1] + 1) - xm(s.span[0]) < 70 ? monthTick(s.span[0]) : (s.caption ?? s.label)}
            </text>
          </g>
        ))}
        {Array.from({ length: months + 1 }, (_, i) => (
          <g key={`t${i}`}>
            <line x1={xm(t0 + i)} x2={xm(t0 + i)} y1={y(0)} y2={y(0) + 4} stroke="var(--line)" />
            {(i % tickStep === 0 && i < months) && <text x={xm(t0 + i) + 2} y={y(0) + 14} textAnchor="start">{monthTick(t0 + i)}</text>}
          </g>
        ))}
        {BARS.map(([k, , color]) => (
          <g key={k}>
            {series.map((s, i) => {
              const next = series[i + 1];
              return (
                <g key={i}>
                  <line x1={xm(s.span[0])} x2={xm(s.span[1] + 1)} y1={y(s[k])} y2={y(s[k])} stroke={color} strokeWidth={2.6} strokeLinecap="round" />
                  {next && (
                    <line x1={xm(s.span[1] + 1)} x2={xm(next.span[0])} y1={y(s[k])} y2={y(next[k])} stroke={color} strokeWidth={1.4} strokeDasharray="3 3" opacity={0.7} />
                  )}
                  <circle cx={xm(s.span[1] + 1)} cy={y(s[k])} r={isSel(s) ? 4 : 3} fill={color} />
                </g>
              );
            })}
          </g>
        ))}
        {ends.map((l) => (
          <text key={l.k} x={W - m.r + 9} y={l.ly + 4} fill={l.color} fontWeight={600}>{`${l.label} ${fmt(last[l.k])}`}</text>
        ))}
        {series.map((s, i) => (
          <g key={`h${i}`}>
            {!!s.notes && <circle cx={(xm(s.span[0]) + xm(s.span[1] + 1)) / 2} cy={m.t + 6} r={5} fill="var(--note)" />}
            <rect
              x={xm(s.span[0])}
              y={0}
              width={xm(s.span[1] + 1) - xm(s.span[0])}
              height={H}
              fill="transparent"
              style={{ cursor: onPick ? 'pointer' : undefined }}
              onMouseMove={(e) => setTip({
                x: e.clientX,
                y: e.clientY,
                lines: [
                  `${s.caption ?? s.label} (${monthTick(s.span[0])} – ${monthTick(s.span[1])})`,
                  `Local ${fmt(s.local)} · In ${fmt(s.pin)} · Out ${fmt(s.pout)}`,
                  `Net ${signed(s.pout - s.pin)}${s.extra ? ` · ${s.extra}` : ''}`,
                  ...(s.notes ? [`${s.notes}${s.notes > 1 ? ' notes' : ' note'}`] : []),
                ],
              })}
              onMouseLeave={() => setTip(null)}
              onClick={() => onPick?.(s.key ?? s.label)}
            />
          </g>
        ))}
      </svg>
      <TipBox tip={tip} />
    </>
  );
}

/** Period-by-period line chart with note markers. Points select by `key` (falls back to `label`). */
export function TrendChart({ series, selected, onPick }) {
  const [tip, setTip] = useState(null);
  if (!series.length) return <p className={cx('empty')}>Nothing to chart yet.</p>;
  // Months and quarters don't overlap, so each can be drawn over its own date range.
  const ranged = series.every((s) => s.span)
    && series.every((s, i) => i === 0 || s.span[0] > series[i - 1].span[1]);
  if (ranged) {
    return (
      <>
        <RangeChart series={series} selected={selected} onPick={onPick} />
        {series.length === 1 && (
          <p className={cx('status')}>
            One date range loaded ({series[0].caption ?? series[0].label}). Each new month or quarter you upload adds its own range, and the line steps between them.
          </p>
        )}
      </>
    );
  }
  const W = 640;
  const H = 240;
  const m = { l: 34, r: 12, t: 12, b: 34 };
  const max = Math.max(4, ...series.flatMap((s) => [s.local, s.pin, s.pout]));
  const step = 10 ** Math.floor(Math.log10(max));
  const nice = Math.ceil(max / (step / 2)) * (step / 2);
  // Date axis: each point sits at the month its period ends, so gaps between periods show as gaps.
  const dated = series.every((s) => s.span);
  const t0 = dated ? Math.min(...series.map((s) => s.span[1])) : 0;
  const t1 = dated ? Math.max(...series.map((s) => s.span[1])) : 0;
  const xm = (t) => m.l + ((t - t0) * (W - m.l - m.r)) / Math.max(1, t1 - t0);
  const x = (i) => (dated ? xm(series[i].span[1]) : m.l + (i * (W - m.l - m.r)) / (series.length - 1));
  const y = (v) => H - m.b - (v / nice) * (H - m.t - m.b);
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Local sales, pumped in and pumped out over time">
        {dated && Array.from({ length: t1 - t0 + 1 }, (_, i) => (
          <line key={`m${i}`} x1={xm(t0 + i)} x2={xm(t0 + i)} y1={y(0)} y2={y(0) + 4} stroke="var(--line)" />
        ))}
        {[0, 1, 2, 3, 4].map((i) => {
          const v = (nice * i) / 4;
          return (
            <g key={i}>
              <line x1={m.l} x2={W - m.r} y1={y(v)} y2={y(v)} stroke="var(--line-soft)" />
              <text x={m.l - 6} y={y(v) + 4} textAnchor="end">{fmt(v)}</text>
            </g>
          );
        })}
        {series.map((s, i) => (
          <g key={s.key ?? s.label}>
            {(s.key ?? s.label) === selected && (
              <rect x={x(i) - 18} y={m.t} width={36} height={H - m.t - m.b} fill="var(--accent-soft)" rx={4} />
            )}
            <text
              x={x(i)}
              y={H - m.b + 18}
              textAnchor="middle"
              fill={(s.key ?? s.label) === selected ? 'var(--fg)' : undefined}
              fontWeight={(s.key ?? s.label) === selected ? 600 : undefined}
            >
              {s.label}
            </text>
          </g>
        ))}
        {SERIES.map(([k, color]) => (
          <g key={k}>
            <polyline
              points={series.map((s, i) => `${x(i)},${y(s[k])}`).join(' ')}
              fill="none"
              stroke={color}
              strokeWidth={2.2}
              strokeLinejoin="round"
            />
            {series.map((s, i) => (
              <circle key={i} cx={x(i)} cy={y(s[k])} r={(s.key ?? s.label) === selected ? 4 : 3} fill={color} />
            ))}
          </g>
        ))}
        {series.map((s, i) => (
          <g key={`h${i}`}>
            {!!s.notes && <circle cx={x(i)} cy={m.t + 6} r={5} fill="var(--note)" />}
            <rect
              x={x(i) - 22}
              y={0}
              width={44}
              height={H}
              fill="transparent"
              style={{ cursor: onPick ? 'pointer' : undefined }}
              onMouseMove={(e) => setTip({
                x: e.clientX,
                y: e.clientY,
                lines: [
                  s.label,
                  `Local ${fmt(s.local)} · In ${fmt(s.pin)} · Out ${fmt(s.pout)}`,
                  `Net ${signed(s.pout - s.pin)}${s.extra ? ` · ${s.extra}` : ''}`,
                  ...(s.notes ? [`${s.notes}${s.notes > 1 ? ' notes' : ' note'}`] : []),
                ],
              })}
              onMouseLeave={() => setTip(null)}
              onClick={() => onPick?.(s.key ?? s.label)}
            />
          </g>
        ))}
      </svg>
      <TipBox tip={tip} />
    </>
  );
}

/** Small multiple for rolling 12-month trends. */
export function MiniChart({ series }) {
  const [tip, setTip] = useState(null);
  const W = 320;
  const H = 150;
  if (series.length === 1) return <SnapshotLines s={series[0]} W={W} H={H} caption={`12 mo to ${series[0].label}`} />;
  const m = { l: 30, r: 10, t: 10, b: 26 };
  const max = Math.max(4, ...series.flatMap((s) => [s.local, s.pin, s.pout]));
  const x = (i) => (series.length === 1 ? W / 2 : m.l + (i * (W - m.l - m.r)) / (series.length - 1));
  const y = (v) => H - m.b - (v / max) * (H - m.t - m.b);
  const step = Math.ceil(series.length / 4);
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Rolling 12-month trend">
        {[0, max / 2, max].map((v) => (
          <g key={v}>
            <line x1={m.l} x2={W - m.r} y1={y(v)} y2={y(v)} stroke="var(--line-soft)" />
            <text x={m.l - 5} y={y(v) + 4} textAnchor="end">{fmt(v)}</text>
          </g>
        ))}
        {series.map((s, i) => (i % step === 0 || i === series.length - 1) && (
          <text
            key={i}
            x={x(i)}
            y={H - 8}
            textAnchor={series.length > 1 && i === 0 ? 'start' : series.length > 1 && i === series.length - 1 ? 'end' : 'middle'}
          >
            {s.label}
          </text>
        ))}
        {SERIES.map(([k, color]) => (
          <g key={k}>
            <polyline points={series.map((s, i) => `${x(i)},${y(s[k])}`).join(' ')} fill="none" stroke={color} strokeWidth={2} />
            {series.map((s, i) => (
              <circle key={i} cx={x(i)} cy={y(s[k])} r={i === series.length - 1 ? 3.5 : 2.5} fill={color} />
            ))}
          </g>
        ))}
        {series.map((s, i) => (
          <rect
            key={`h${i}`}
            x={x(i) - 14}
            y={0}
            width={28}
            height={H}
            fill="transparent"
            onMouseMove={(e) => setTip({
              x: e.clientX,
              y: e.clientY,
              lines: [`Rolling 12 to ${s.label}`, `Local ${fmt(s.local)} · In ${fmt(s.pin)} · Out ${fmt(s.pout)}`],
            })}
            onMouseLeave={() => setTip(null)}
          />
        ))}
      </svg>
      <TipBox tip={tip} />
    </>
  );
}

export function Spark({ vals, color, max }) {
  const W = 90;
  const H = 24;
  if (!vals.length) return null;
  const x = (i) => (vals.length === 1 ? W - 4 : 2 + (i * (W - 4)) / (vals.length - 1));
  const y = (v) => H - 3 - (v / (max || 1)) * (H - 6);
  // A single period is drawn as a level line across the cell so it still reads as a line.
  const pts = vals.length === 1
    ? (vals[0] == null ? '' : `2,${y(vals[0])} ${W - 4},${y(vals[0])}`)
    : vals.map((v, i) => (v == null ? null : `${x(i)},${y(v)}`)).filter(Boolean).join(' ');
  const last = vals.length - 1;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.6} />
      {vals[last] != null && <circle cx={x(last)} cy={y(vals[last])} r={2.4} fill={color} />}
    </svg>
  );
}
