'use client';

import VdpInventoryDonut from '@/components/dashboard/VdpInventoryDonut';
import { fetchModelBreakdown } from '@/lib/api/dashboardApi';

const MODEL_COLORS = [
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
  return MODEL_COLORS[Math.min(Math.max(r - 1, 0), MODEL_COLORS.length - 1)];
}

function truncateLabel(label, max = 22) {
  if (!label || label.length <= max) return label;
  return `${label.slice(0, max - 1)}…`;
}

function normalizeRows(data) {
  const list = Array.isArray(data) ? data : data ? [data] : [];
  // Dedupe by model+make in case RPC/whitespace returns twin rows.
  const byKey = new Map();
  for (const row of list) {
    const model = String(row.model_bucket ?? row.inv_model ?? 'Other').trim() || 'Other';
    const make = String(row.make_bucket ?? row.inv_make ?? '').trim();
    const key = `${model.toLowerCase()}||${make.toLowerCase()}`;
    const views = Number(row.views ?? 0) || 0;
    const prev = byKey.get(key);
    if (prev) {
      prev.views += views;
    } else {
      byKey.set(key, {
        model_bucket: model,
        make_bucket: make,
        views,
        pct: Number(row.pct ?? row.percentage ?? 0) || 0,
        rank: Number(row.rank ?? 999) || 999,
      });
    }
  }

  const merged = [...byKey.values()].sort(
    (a, b) => b.views - a.views || a.model_bucket.localeCompare(b.model_bucket)
  );
  const total = merged.reduce((s, r) => s + r.views, 0) || 0;
  return merged.map((row, index) => ({
    ...row,
    pct: total > 0 ? Math.round((10000 * row.views) / total) / 100 : 0,
    rank: row.model_bucket === 'Other' ? 999 : index + 1,
  }));
}

function rowTooltip(row) {
  const make = row.make_bucket && row.rank !== 999 ? ` (${row.make_bucket})` : '';
  return `${row.model_bucket}${make}`;
}

function toDonutRow(row, index = 0) {
  const fullName = rowTooltip(row);
  return {
    // Stable unique id — truncated `name` alone collides across models.
    id: `model:${row.model_bucket}|${row.make_bucket}|${row.rank}|${index}`,
    name: truncateLabel(row.model_bucket),
    fullName,
    color: colorForRank(row.rank),
    value: row.views,
    pct: row.pct,
  };
}

export default function ModelBreakdown(props) {
  return (
    <VdpInventoryDonut
      title="Model Breakdown"
      fetchFn={fetchModelBreakdown}
      normalize={normalizeRows}
      errorMessage="Failed to load model breakdown."
      toDonutRow={toDonutRow}
      emptyMessage="No model data for this period."
      keepPreviousOnReload={false}
      {...props}
    />
  );
}
