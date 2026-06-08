import { daysBackForFinalSync } from '@/lib/pipeline/dates';

/** Step 2 — apply_vdp_filtration(p_client_id, p_days_back) */
export async function runVdpFiltration(
  supabase,
  clientId,
  { from, to, daysBack } = {}
) {
  const p_days_back =
    daysBack ?? (from && to ? daysBackForFinalSync(from, to) : null);

  const { data, error } = await supabase.rpc('apply_vdp_filtration', {
    p_client_id: clientId,
    p_days_back,
  });

  if (error) {
    const hint = /could not choose the best candidate/i.test(error.message || '')
      ? ' Run supabase/rpc/apply_vdp_filtration.sql in Supabase to drop the legacy 1-arg overload.'
      : '';
    throw new Error((error.message || 'apply_vdp_filtration failed') + hint);
  }

  const processed = (data || []).map((row) => ({
    accountName: row.out_account_name ?? row.account_name ?? 'Unknown',
    cms: row.out_cms ?? row.cms ?? 'Unknown',
    rowsUpdated: Number(row.out_updated_rows ?? row.count ?? 0) || 0,
  }));

  const totalRowsUpdated = processed.reduce((s, r) => s + r.rowsUpdated, 0);

  const log = [
    `apply_vdp_filtration(p_client_id=${clientId}, p_days_back=${p_days_back ?? 'ALL'})`,
    `Rows updated: ${totalRowsUpdated.toLocaleString()}`,
    ...processed.map(
      (r) =>
        `  ${r.accountName} · CMS ${r.cms} · ${r.rowsUpdated.toLocaleString()} rows`
    ),
  ];

  return {
    success: true,
    clientId,
    daysBack: p_days_back,
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

/** Step 3 — build_smart_final_data with explicit From → To when RPC supports it. */
export async function runFinalVdpSync(supabase, clientId, { from, to, daysBack } = {}) {
  const rangeFrom = from || null;
  const rangeTo = to || null;
  const legacyDaysBack =
    daysBack ?? (rangeFrom && rangeTo ? daysBackForFinalSync(rangeFrom, rangeTo) : null);

  const withDateRange = {
    p_client_id: clientId,
    p_date_from: rangeFrom,
    p_date_to: rangeTo,
    p_days_back: null,
  };

  const legacyOnly = {
    p_client_id: clientId,
    p_days_back: legacyDaysBack,
  };

  let rpcMode = 'date_range';
  let { data, error } = await supabase.rpc('build_smart_final_data', withDateRange);

  if (error && isMissingRpcParamError(error.message)) {
    rpcMode = 'days_back';
    ({ data, error } = await supabase.rpc('build_smart_final_data', legacyOnly));
  }

  if (error) {
    throw new Error(
      error.message ||
        'build_smart_final_data failed. Deploy supabase/rpc/build_smart_final_data.sql (with p_date_from / p_date_to).'
    );
  }

  const summary = (data || []).map((row) => ({
    clientId: row.client_id ?? row.out_client_id ?? clientId,
    accountName: row.out_account_name ?? row.account_name ?? null,
    cms: row.out_cms ?? row.cms ?? null,
    totalRows: Number(row.out_total_rows ?? 0) || 0,
    vdpRows: Number(row.out_vdp_true_rows ?? 0) || 0,
  }));

  const totalRows = summary.reduce((s, r) => s + r.totalRows, 0);
  const totalVdpTrue = summary.reduce((s, r) => s + r.vdpRows, 0);

  const log = [
    rpcMode === 'date_range'
      ? `build_smart_final_data(p_client_id=${clientId}, p_date_from=${rangeFrom}, p_date_to=${rangeTo})`
      : `build_smart_final_data(p_client_id=${clientId}, p_days_back=${legacyDaysBack}) [legacy — deploy updated RPC for exact dates]`,
    `Total rows: ${totalRows.toLocaleString()} · inventory matched (vdp_conditions=true): ${totalVdpTrue.toLocaleString()}`,
    ...summary.map(
      (r) =>
        `  ${r.accountName || r.clientId} · CMS ${r.cms || '—'} · ${r.totalRows.toLocaleString()} rows · matched ${r.vdpRows.toLocaleString()}`
    ),
  ];

  return {
    success: true,
    rpcUsed: 'build_smart_final_data',
    rpcMode,
    clientId,
    from: rangeFrom,
    to: rangeTo,
    daysBack: rpcMode === 'days_back' ? legacyDaysBack : null,
    totalRows,
    totalVdpTrue,
    summary,
    processed: data ?? [],
    log,
    raw: data,
  };
}
