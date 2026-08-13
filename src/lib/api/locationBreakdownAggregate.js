/**
 * Client-side fallback only when get_location_breakdown RPC returns [] but
 * smart_final_data has rows (PostgREST param mismatch). Mirrors RPC logic.
 */

import { collapseLocationBreakdownRows } from '@/lib/vdp/locationFilterOptions';

export function aggregateLocationBuckets(rawRows) {
  const buckets = new Map();

  for (const row of rawRows) {
    const label =
      row.inv_location == null || String(row.inv_location).trim() === ''
        ? 'Unknown'
        : String(row.inv_location).trim();
    const views = Number(row.views ?? row.view_count ?? 0) || 0;
    if (views <= 0) continue;
    buckets.set(label, (buckets.get(label) || 0) + views);
  }

  // Collapse city variants BEFORE top-5 so Bradenton / Bradenton, FL aren't split
  const collapsed = collapseLocationBreakdownRows(
    [...buckets.entries()].map(([location_bucket, views]) => ({
      location_bucket,
      views,
    }))
  );

  const total = collapsed.reduce((sum, r) => sum + r.views, 0);
  if (total <= 0) return [];

  const top5 = collapsed.slice(0, 5);
  const otherViews = collapsed.slice(5).reduce((sum, r) => sum + r.views, 0);

  const out = top5.map((r, index) => ({
    location_bucket: r.location_bucket,
    views: r.views,
    pct: Math.round((r.views / total) * 10000) / 100,
    rank: index + 1,
  }));

  if (otherViews > 0) {
    out.push({
      location_bucket: 'Other',
      views: otherViews,
      pct: Math.round((otherViews / total) * 10000) / 100,
      rank: 999,
    });
  }

  return out;
}
