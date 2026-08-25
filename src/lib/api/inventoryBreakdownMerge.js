/**
 * Merge chunked inventory-breakdown RPC rows (sum views per bucket, re-rank).
 */

function rowKey(row, bucketKey, secondaryBucketKey) {
  const primary = String(row[bucketKey] ?? 'Unknown').trim() || 'Unknown';
  if (!secondaryBucketKey) return primary;
  const secondary = String(row[secondaryBucketKey] ?? '').trim();
  return `${secondary}||${primary}`;
}

export function mergeInventoryBreakdownRows(
  rows,
  bucketKey,
  secondaryBucketKey = null,
  limit = null
) {
  const totals = new Map();

  for (const row of rows || []) {
    const key = rowKey(row, bucketKey, secondaryBucketKey);
    totals.set(key, (totals.get(key) || 0) + (Number(row.views) || 0));
  }

  const sorted = [...totals.entries()]
    .map(([key, views]) => {
      if (secondaryBucketKey) {
        const [make_bucket, model_bucket] = key.split('||');
        return {
          [secondaryBucketKey]: make_bucket,
          [bucketKey]: model_bucket,
          views,
        };
      }
      return { [bucketKey]: key, views };
    })
    .filter((r) => r.views > 0)
    .sort((a, b) => b.views - a.views);

  const grand = sorted.reduce((sum, r) => sum + r.views, 0);
  if (grand <= 0) return [];

  const cap = limit != null && limit > 0 ? limit : null;
  const top = cap ? sorted.slice(0, cap) : sorted;
  const otherViews = cap
    ? sorted.slice(cap).reduce((sum, r) => sum + r.views, 0)
    : 0;

  const out = top.map((r, index) => ({
    ...r,
    pct: Math.round((r.views / grand) * 10000) / 100,
    rank: index + 1,
  }));

  if (otherViews > 0) {
    out.push({
      ...(secondaryBucketKey
        ? { [secondaryBucketKey]: '', [bucketKey]: 'Other' }
        : { [bucketKey]: 'Other' }),
      views: otherViews,
      pct: Math.round((otherViews / grand) * 10000) / 100,
      rank: 999,
    });
  }

  return out;
}
