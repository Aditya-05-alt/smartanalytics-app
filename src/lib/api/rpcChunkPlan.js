import { dayCountInclusive } from '@/lib/ga4/dateRange';

/**
 * Pick RPC window size from range length + whether inventory filters are active.
 * Smaller windows avoid Postgres statement_timeout on heavy joins.
 */
export function resolveRpcChunkPlan(from, to, { invFilters = false } = {}) {
  const days = dayCountInclusive(from, to);
  if (days <= 0) return { chunkDays: 7, concurrency: 1 };

  if (days <= 31) {
    return { chunkDays: days, concurrency: 1 };
  }
  if (days <= 90) {
    return {
      chunkDays: invFilters ? 7 : 14,
      concurrency: invFilters ? 2 : 3,
    };
  }
  if (days <= 180) {
    return {
      chunkDays: invFilters ? 5 : 10,
      concurrency: 2,
    };
  }
  return {
    chunkDays: invFilters ? 3 : 7,
    concurrency: 2,
  };
}

/** Skip background prefetch when the range is large (avoids 5× duplicate work). */
export function shouldPrefetchBreakdownTabs(from, to) {
  return dayCountInclusive(from, to) <= 45;
}
