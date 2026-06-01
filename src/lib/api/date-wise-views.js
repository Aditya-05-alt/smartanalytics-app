import { createClient } from '@/lib/supabase/client';
import { dayCountInclusive, enumerateDatesInclusive } from '@/lib/ga4/dateRange';

const MAX_DAYS_CLIENT = 31;
const DAY_CONCURRENCY = 3;

function normalizeRow(r) {
  return {
    ...r,
    report_date: String(r.report_date).split('T')[0],
    views: Number(r.views || 0),
  };
}

function isTimeoutError(error) {
  const msg = error?.message || '';
  return error?.code === '57014' || /timeout/i.test(msg);
}

async function rpcOneDay(supabase, day, clientId, onCancelCheck) {
  if (onCancelCheck?.()) return null;

  const { data, error } = await supabase.rpc('build_date_wise_ga4_data', {
    p_date_from: day,
    p_date_to: day,
    p_client_id: clientId,
  });

  if (error) throw error;
  return (data || []).map(normalizeRow);
}

/** Fetch one day at a time to stay under Postgres statement_timeout. */
export async function fetchDateWiseViewsChunked({
  from,
  to,
  clientId = null,
  onCancelCheck,
  onProgress,
}) {
  const supabase = createClient();
  if (!supabase) throw new Error('Supabase is not configured.');

  const days = enumerateDatesInclusive(from, to);
  if (days.length === 0) return [];
  if (days.length > MAX_DAYS_CLIENT) {
    throw new Error(
      `Date range is ${days.length} days. Please use at most ${MAX_DAYS_CLIENT} days (try 10d preset).`
    );
  }

  const merged = [];
  let completed = 0;

  for (let i = 0; i < days.length; i += DAY_CONCURRENCY) {
    if (onCancelCheck?.()) return null;

    const batch = days.slice(i, i + DAY_CONCURRENCY);
    onProgress?.({ completed, total: days.length, label: batch[0] });

    const results = await Promise.all(
      batch.map(async (day) => {
        try {
          return await rpcOneDay(supabase, day, clientId, onCancelCheck);
        } catch (err) {
          if (isTimeoutError(err)) {
            throw new Error(
              `Timed out loading ${day}. Try a shorter range or add the database index in supabase/rpc/build_date_wise_ga4_data.sql.`
            );
          }
          throw err;
        }
      })
    );

    for (const part of results) {
      if (part?.length) merged.push(...part);
    }
    completed += batch.length;
    onProgress?.({ completed, total: days.length });
  }

  return merged;
}

/** Prefer server route (service role, chunked); fallback to client day-chunks. */
export async function fetchDateWiseViews({
  from,
  to,
  clientId = null,
  onCancelCheck,
  onProgress,
}) {
  if (onCancelCheck?.()) return null;

  const qs = new URLSearchParams({ from, to });
  if (clientId) qs.set('clientId', clientId);

  try {
    const res = await fetch(`/api/reports/date-wise-views?${qs}`, {
      credentials: 'same-origin',
    });
    const json = await res.json().catch(() => ({}));

    if (res.ok && Array.isArray(json.rows)) {
      return json.rows.map(normalizeRow);
    }

    if (res.status !== 503 && res.status !== 500) {
      throw new Error(json.error || `Request failed (${res.status})`);
    }
  } catch (err) {
    if (!isTimeoutError(err) && !/fetch/i.test(err?.message || '')) {
      throw err;
    }
  }

  return fetchDateWiseViewsChunked({
    from,
    to,
    clientId,
    onCancelCheck,
    onProgress,
  });
}
