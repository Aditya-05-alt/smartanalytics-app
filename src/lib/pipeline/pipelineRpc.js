import {
  chunkDates,
  coerceDateRange,
  daysBackForFinalSync,
} from '@/lib/pipeline/dates';
import {
  FINAL_RPC_HOOT,
  FINAL_RPC_HOOT_QS,
  resolveFinalVdpRpc,
} from '@/lib/pipeline/inventoryResolve';

/** QS path stays 1-day; fast page_path RPC can do the full admin batch in one call. */
const FINAL_SYNC_CHUNK_DAYS_QS = 1;
const FINAL_SYNC_CHUNK_DAYS_FAST = 366;
const FINAL_SYNC_MAX_ATTEMPTS = 3;

function isRetryableFinalSyncError(message) {
  return /520|522|524|502|503|timeout|timed out|fetch failed|ECONNRESET|upstream/i.test(
    message || ''
  );
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Step 2 — apply_vdp_filtration_range(p_client_id, p_from, p_to) */
export async function runVdpFiltration(supabase, clientId, { from, to } = {}) {
  if (!from || !to) {
    throw new Error('from and to are required for Step 2 filtration.');
  }

  const { from: rangeFrom, to: rangeTo } = coerceDateRange(from, to);

  const { data, error } = await supabase.rpc('apply_vdp_filtration_range', {
    p_client_id: clientId,
    p_from: rangeFrom,
    p_to: rangeTo,
  });

  if (error) {
    throw new Error(
      error.message ||
        'apply_vdp_filtration_range failed. Deploy supabase/rpc/apply_vdp_filtration_range.sql in Supabase.'
    );
  }

  const processed = (data || []).map((row) => ({
    accountName: row.out_account_name ?? row.account_name ?? 'Unknown',
    cms: row.out_cms ?? row.cms ?? 'Unknown',
    rowsUpdated: Number(row.out_updated_rows ?? row.count ?? 0) || 0,
  }));

  const totalRowsUpdated = processed.reduce((s, r) => s + r.rowsUpdated, 0);

  const log = [
    `apply_vdp_filtration_range(p_client_id=${clientId}, p_from=${rangeFrom}, p_to=${rangeTo})`,
    `Rows updated: ${totalRowsUpdated.toLocaleString()}`,
    ...processed.map(
      (r) =>
        `  ${r.accountName} · CMS ${r.cms} · ${r.rowsUpdated.toLocaleString()} rows`
    ),
  ];

  return {
    success: true,
    clientId,
    from: rangeFrom,
    to: rangeTo,
    totalRowsUpdated,
    processed,
    log,
    raw: data,
  };
}

function isMissingRpcParamError(message) {
  return /could not find the function|does not exist|unknown argument|schema cache/i.test(
    message || ''
  );
}

/** Step 3 — hoot / hoot-qs / scrap RPC per dealer.
 *  QS dealers: 1-day chunks (heavy match). Others: full range (fast page_path path).
 */
export async function runFinalVdpSync(
  supabase,
  clientId,
  { from, to, daysBack, rpcName: rpcNameOverride } = {}
) {
  const { from: rangeFrom, to: rangeTo, dates } = coerceDateRange(from, to);
  const legacyDaysBack =
    daysBack ?? (rangeFrom && rangeTo ? daysBackForFinalSync(rangeFrom, rangeTo) : null);

  const inventory =
    rpcNameOverride != null
      ? {
          rpcName: rpcNameOverride,
          inventorySource:
            rpcNameOverride === FINAL_RPC_HOOT ||
            rpcNameOverride === FINAL_RPC_HOOT_QS
              ? 'hoot'
              : 'scrap',
        }
      : await resolveFinalVdpRpc(supabase, clientId);

  const rpcName = inventory.rpcName;
  const chunkDays =
    rpcName === FINAL_RPC_HOOT_QS
      ? FINAL_SYNC_CHUNK_DAYS_QS
      : FINAL_SYNC_CHUNK_DAYS_FAST;
  const chunks = chunkDates(dates, chunkDays);
  const log = [
    `${rpcName}(p_client_id=${clientId}, p_date_from=${rangeFrom}, p_date_to=${rangeTo})`,
    chunks.length > 1
      ? `Chunked into ${chunks.length} × ${chunkDays}-day call(s)`
      : `Single call for ${rangeFrom} → ${rangeTo}`,
  ];

  let totalRows = 0;
  let totalVdpTrue = 0;
  let accountName = null;
  let cms = null;
  let rpcMode = 'date_range';
  const chunkResults = [];

  async function callChunk(chunkFrom, chunkTo) {
    const withDateRange = {
      p_client_id: clientId,
      p_date_from: chunkFrom,
      p_date_to: chunkTo,
      p_days_back: null,
    };
    const legacyOnly = {
      p_client_id: clientId,
      p_days_back: legacyDaysBack,
    };

    let lastError = null;
    for (let attempt = 1; attempt <= FINAL_SYNC_MAX_ATTEMPTS; attempt++) {
      let data;
      let error;
      let mode = 'date_range';
      ({ data, error } = await supabase.rpc(rpcName, withDateRange));

      if (error && isMissingRpcParamError(error.message)) {
        mode = 'days_back';
        ({ data, error } = await supabase.rpc(rpcName, legacyOnly));
      }

      if (!error) {
        return { data, mode };
      }

      lastError = error;
      if (!isRetryableFinalSyncError(error.message) || attempt === FINAL_SYNC_MAX_ATTEMPTS) {
        throw new Error(
          error.message ||
            `${rpcName} failed. Deploy supabase/rpc/${rpcName}.sql (with p_date_from / p_date_to).`
        );
      }
      await sleep(1500 * attempt);
    }
    throw lastError || new Error(`${rpcName} failed`);
  }

  if (!chunks.length) {
    throw new Error('Invalid or empty date range for Step 3.');
  }

  for (const chunk of chunks) {
    const chunkFrom = chunk[0];
    const chunkTo = chunk[chunk.length - 1];
    const { data, mode } = await callChunk(chunkFrom, chunkTo);
    rpcMode = mode;

    // Legacy days_back rebuilds the whole window — do not loop further.
    if (mode === 'days_back') {
      const row = (data || [])[0];
      totalRows = Number(row?.out_total_rows ?? 0) || 0;
      totalVdpTrue = Number(row?.out_vdp_true_rows ?? 0) || 0;
      accountName = row?.out_account_name ?? row?.account_name ?? null;
      cms = row?.out_cms ?? row?.cms ?? null;
      log.push(
        `  ${chunkFrom}→${chunkTo}: legacy p_days_back=${legacyDaysBack} · ${totalRows} rows · matched ${totalVdpTrue}`
      );
      break;
    }

    const row = (data || [])[0];
    const rows = Number(row?.out_total_rows ?? 0) || 0;
    const matched = Number(row?.out_vdp_true_rows ?? 0) || 0;
    totalRows += rows;
    totalVdpTrue += matched;
    accountName = row?.out_account_name ?? row?.account_name ?? accountName;
    cms = row?.out_cms ?? row?.cms ?? cms;
    chunkResults.push({ from: chunkFrom, to: chunkTo, rows, matched });
    log.push(`  ${chunkFrom}→${chunkTo}: ${rows.toLocaleString()} rows · matched ${matched.toLocaleString()}`);
  }

  const summary = [
    {
      clientId,
      accountName,
      cms,
      totalRows,
      vdpRows: totalVdpTrue,
    },
  ];

  log.push(
    `Total rows: ${totalRows.toLocaleString()} · inventory matched (vdp_conditions=true): ${totalVdpTrue.toLocaleString()}`
  );
  log.push(
    `  ${accountName || clientId} · CMS ${cms || '—'} · ${totalRows.toLocaleString()} rows · matched ${totalVdpTrue.toLocaleString()}`
  );

  return {
    success: true,
    rpcUsed: rpcName,
    inventorySource: inventory.inventorySource,
    rpcMode,
    clientId,
    from: rangeFrom,
    to: rangeTo,
    chunkDays,
    daysBack: rpcMode === 'days_back' ? legacyDaysBack : null,
    chunks: chunkResults,
    totalRows,
    totalVdpTrue,
    summary,
    processed: summary,
    log,
    raw: summary,
  };
}
