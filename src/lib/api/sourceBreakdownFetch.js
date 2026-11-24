import { createClient } from '@/lib/supabase/client';
import { rpcByDateChunksProgressive } from '@/lib/api/chunkedRpc';
import { resolveRpcChunkPlan } from '@/lib/api/rpcChunkPlan';
import { pilotBreakdownChunkPlan } from '@/lib/api/ga4SummaryPilot';
import { appendAnalyticsScope, withPropertyRpcParams } from '@/lib/analytics/analyticsScope';
import {
  appendInvParamsToSearchParams,
  channelFiltersActive,
  vdpRpcExtraParams,
} from '@/lib/vdp/vdpFilterParams';
import { mergeChannelBreakdownRows } from '@/lib/ga4/channelBreakdownMerge';

const SOURCE_RPC = 'get_ga4_source_breakdown';

function mergeSourceRows(rows) {
  const merged = mergeChannelBreakdownRows(
    (rows || []).map((row) => ({
      channel_bucket: row.source_bucket ?? row.channel_bucket,
      views: row.views,
      pct: row.pct,
    }))
  );
  return merged.map((row) => ({
    source_bucket: row.channel_bucket,
    views: row.views,
    pct: row.pct,
  }));
}

async function fetchSourceBreakdownViaApi({
  clientId,
  from,
  to,
  ga4PropertyId,
  vdpFilters,
  tab,
  onCancelCheck,
}) {
  if (typeof window === 'undefined') return null;
  if (onCancelCheck?.()) return null;

  const qs = appendAnalyticsScope(
    new URLSearchParams({
      clientId: String(clientId).trim(),
      from: String(from).slice(0, 10),
      to: String(to).slice(0, 10),
      pageType: 'VDP',
    }),
    { ga4PropertyId }
  );
  appendInvParamsToSearchParams(qs, vdpRpcExtraParams(vdpFilters, tab));

  const res = await fetch(`/api/dashboard/source-breakdown?${qs}`, {
    credentials: 'same-origin',
  });
  const json = await res.json().catch(() => ({}));

  if (onCancelCheck?.()) return null;
  if (!res.ok) {
    if (res.status === 503) return null;
    throw new Error(json.error || `Source breakdown request failed (${res.status})`);
  }

  return json.rows || [];
}

/** Chunked GA4 source breakdown for Overview VDP tab. */
export async function fetchSourceBreakdownChunked({
  clientId,
  from,
  to,
  vdpFilters,
  tab = 'vdp',
  ga4PropertyId,
  onCancelCheck,
  onProgress,
}) {
  if (!clientId || !from || !to) return [];
  if (onCancelCheck?.()) return null;

  try {
    const viaApi = await fetchSourceBreakdownViaApi({
      clientId,
      from,
      to,
      ga4PropertyId,
      vdpFilters,
      tab,
      onCancelCheck,
    });
    if (onCancelCheck?.()) return null;
    if (viaApi != null) {
      const rows = mergeSourceRows(viaApi);
      onProgress?.(rows, { completed: 1, total: 1, fromServer: true });
      return rows;
    }
  } catch (err) {
    if (onCancelCheck?.()) return null;
    console.warn('[source-breakdown] API failed, using chunked client RPC', err);
  }

  const supabase = createClient();
  if (!supabase) throw new Error('Supabase is not configured.');

  const invFilters = channelFiltersActive(vdpFilters, tab);
  const extraParams = withPropertyRpcParams(
    {
      p_page_type: 'VDP',
      ...vdpRpcExtraParams(vdpFilters, tab),
    },
    ga4PropertyId
  );

  const { chunkDays, concurrency } = await pilotBreakdownChunkPlan(
    supabase,
    clientId,
    from,
    to,
    resolveRpcChunkPlan(from, to, { invFilters, pageType: 'VDP' }),
    extraParams.p_channels
  );

  const merged = [];
  const raw = await rpcByDateChunksProgressive(supabase, SOURCE_RPC, {
    clientId,
    from,
    to,
    extraParams,
    chunkDays,
    concurrency,
    onCancelCheck,
    onBatch: (batch, meta) => {
      if (onCancelCheck?.()) return;
      merged.length = 0;
      merged.push(...batch);
      onProgress?.(mergeSourceRows(merged), meta);
    },
  });

  if (onCancelCheck?.()) return null;
  return mergeSourceRows(raw || []);
}
