'use client';

import VdpInventoryDonut from '@/components/dashboard/VdpInventoryDonut';
import { fetchSourceBreakdown } from '@/lib/api/dashboardApi';
import { sourceDisplayLabel } from '@/lib/ga4/sourceGroups';

const SOURCE_COLORS = [
  '#60a5fa',
  '#34d399',
  '#f472b6',
  '#fb923c',
  '#a78bfa',
  '#facc15',
  '#22d3ee',
  '#a3e635',
  '#fb7185',
  '#94a3b8',
];

function colorForIndex(index) {
  return SOURCE_COLORS[Math.min(Math.max(index, 0), SOURCE_COLORS.length - 1)];
}

function normalizeRows(data) {
  const list = Array.isArray(data) ? data : data ? [data] : [];
  return list
    .map((row, index) => {
      const key = String(row.source_bucket ?? row.source ?? '(none)');
      return {
        source_bucket: key,
        views: Number(row.views ?? 0) || 0,
        pct: Number(row.pct ?? row.percentage ?? 0) || 0,
        rank: Number(row.rank ?? index + 1) || index + 1,
      };
    })
    .sort((a, b) => b.views - a.views || a.source_bucket.localeCompare(b.source_bucket))
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

function toDonutRow(row, index) {
  const name = sourceDisplayLabel(row.source_bucket);
  return {
    name,
    fullName: name,
    color: colorForIndex(index ?? row.rank - 1),
    value: row.views,
    pct: row.pct,
  };
}

export default function SourceBreakdown(props) {
  return (
    <VdpInventoryDonut
      title="Source Breakdown"
      fetchFn={fetchSourceBreakdown}
      normalize={normalizeRows}
      errorMessage="Failed to load source breakdown."
      toDonutRow={toDonutRow}
      emptyMessage="No source data for this period."
      {...props}
    />
  );
}
