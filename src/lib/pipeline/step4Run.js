import { coerceDateRange } from '@/lib/pipeline/dates';
import { applyLogic2UnknownFill } from '@/lib/pipeline/logic2UnknownFill';
import { runFinalVdpSync, runVdpFiltration } from '@/lib/pipeline/pipelineRpc';

function num(v) {
  return Number(v) || 0;
}

function isBlankOrOther(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return !s || s === 'other' || s === 'unknown';
}

/**
 * Sync smart_vdp_logic_2.vdp_logic from live smart_vdp_logic when blank.
 */
export async function syncLogic2FromLive(supabase, clientId) {
  const log = [];
  const { data: live, error: liveErr } = await supabase
    .from('smart_vdp_logic')
    .select(
      'dealer_id, dealer_name, cms, website_url, data_source, scrap_link, hoot_link, vdp_logic, home_page_logic'
    )
    .eq('dealer_id', clientId)
    .maybeSingle();

  if (liveErr) throw new Error(liveErr.message || 'Failed to read smart_vdp_logic');
  if (!live) {
    log.push(`No smart_vdp_logic row for dealer_id=${clientId}`);
    return { synced: false, reason: 'no_live_row', log };
  }

  const { data: row2, error: findErr } = await supabase
    .from('smart_vdp_logic_2')
    .select('dealer_id, vdp_logic')
    .eq('dealer_id', clientId)
    .maybeSingle();

  if (findErr) throw new Error(findErr.message || 'Failed to read smart_vdp_logic_2');
  if (!row2) {
    log.push(`No smart_vdp_logic_2 row for dealer_id=${clientId} — add dealer to logic_2 first`);
    return { synced: false, reason: 'no_logic2_row', log };
  }

  const hasLogic2 = Boolean(String(row2.vdp_logic || '').trim());
  if (hasLogic2) {
    log.push('smart_vdp_logic_2 already has vdp_logic — left unchanged');
    return {
      synced: false,
      reason: 'already_set',
      vdpLogic: row2.vdp_logic,
      log,
    };
  }

  const liveLogic = String(live.vdp_logic || '').trim();
  if (!liveLogic) {
    log.push('Live smart_vdp_logic.vdp_logic is blank — nothing to copy');
    return { synced: false, reason: 'live_blank', log };
  }

  const { data: updated, error: updErr } = await supabase
    .from('smart_vdp_logic_2')
    .update({
      dealer_name: live.dealer_name,
      cms: live.cms,
      website_url: live.website_url,
      data_source: live.data_source,
      scrap_link: live.scrap_link,
      hoot_link: live.hoot_link,
      home_page_logic: live.home_page_logic,
      vdp_logic: live.vdp_logic,
    })
    .eq('dealer_id', clientId)
    .select('vdp_logic, cms, website_url')
    .maybeSingle();

  if (updErr) throw new Error(updErr.message || 'Failed to sync smart_vdp_logic_2');

  log.push(`Synced logic_2 from live: ${liveLogic.slice(0, 120)}${liveLogic.length > 120 ? '…' : ''}`);
  return {
    synced: true,
    reason: 'copied_from_live',
    vdpLogic: updated?.vdp_logic || live.vdp_logic,
    cms: updated?.cms,
    websiteUrl: updated?.website_url,
    log,
  };
}

async function loadUnknownUrls(supabase, clientId, from, to) {
  const { data, error } = await supabase.rpc('get_pipeline_unknown_urls', {
    p_client_id: clientId,
    p_from: from,
    p_to: to,
  });
  if (!error && Array.isArray(data)) {
    const urls = data;
    return {
      uniqueUrls: urls.length,
      totalViews: urls.reduce((s, u) => s + num(u.views), 0),
      totalRows: urls.reduce((s, u) => s + num(u.rows), 0),
      urls,
      source: 'rpc',
    };
  }

  // Fallback scan (capped)
  const { data: rows, error: qErr } = await supabase
    .from('smart_final_data')
    .select('page_path, page_location, views, inv_make, inv_url, vdp_conditions')
    .eq('client_id', clientId)
    .gte('report_date', from)
    .lte('report_date', to)
    .eq('vdp_conditions', true)
    .limit(200000);

  if (qErr) throw new Error(qErr.message || error?.message || 'Unknown URL load failed');

  const map = new Map();
  for (const row of rows || []) {
    const blankMake = isBlankOrOther(row.inv_make);
    const blankUrl = !String(row.inv_url || '').trim();
    if (!blankMake && !blankUrl) continue;
    const path = String(row.page_path || '').trim();
    if (!path) continue;
    const prev = map.get(path) || {
      page_path: path,
      page_location: row.page_location || null,
      rows: 0,
      views: 0,
    };
    prev.rows += 1;
    prev.views += num(row.views);
    map.set(path, prev);
  }
  const urls = [...map.values()].sort(
    (a, b) => b.views - a.views || a.page_path.localeCompare(b.page_path)
  );
  return {
    uniqueUrls: urls.length,
    totalViews: urls.reduce((s, u) => s + u.views, 0),
    totalRows: urls.reduce((s, u) => s + u.rows, 0),
    urls,
    source: 'fallback',
  };
}

async function loadExceptionUrls(supabase, clientId, from, to) {
  const { data, error } = await supabase.rpc('get_pipeline_exception_urls', {
    p_client_id: clientId,
    p_from: from,
    p_to: to,
  });
  if (error) {
    return {
      uniqueUrls: 0,
      totalViews: 0,
      totalRows: 0,
      urls: [],
      hasLogic2: false,
      error: error.message,
    };
  }
  const urls = Array.isArray(data) ? data : data?.urls || [];
  // RPC may return table or wrapped — normalize
  if (Array.isArray(data) && data[0]?.page_path != null) {
    return {
      uniqueUrls: data.length,
      totalViews: data.reduce((s, u) => s + num(u.views), 0),
      totalRows: data.reduce((s, u) => s + num(u.rows), 0),
      urls: data,
      hasLogic2: true,
    };
  }
  return {
    uniqueUrls: num(data?.unique_urls ?? urls.length),
    totalViews: num(data?.total_views),
    totalRows: num(data?.total_rows),
    urls,
    hasLogic2: Boolean(data?.has_logic2 ?? true),
  };
}

/**
 * Aggregate Final VDP breakdown gaps for custom-fix checklist.
 */
async function loadBreakdownGaps(supabase, clientId, from, to) {
  const { data: rows, error } = await supabase
    .from('smart_final_data')
    .select(
      'views, inv_make, inv_url, inv_condition, inv_type, inv_custom_type, inv_location, inv_year'
    )
    .eq('client_id', clientId)
    .gte('report_date', from)
    .lte('report_date', to)
    .eq('vdp_conditions', true)
    .limit(500000);

  if (error) throw new Error(error.message || 'Breakdown load failed');

  let finalVdp = 0;
  let unknownViews = 0;
  let blankLoc = 0;
  let blankCond = 0;
  let otherType = 0;
  let year0 = 0;
  const condMix = new Map();
  const typeMix = new Map();

  for (const row of rows || []) {
    const v = num(row.views);
    finalVdp += v;

    const blankUrl = !String(row.inv_url || '').trim();
    const blankMake = isBlankOrOther(row.inv_make);
    if (blankUrl || blankMake) unknownViews += v;

    if (!String(row.inv_location || '').trim()) blankLoc += v;
    if (!String(row.inv_condition || '').trim() || ['other', 'unknown'].includes(String(row.inv_condition || '').trim().toLowerCase())) {
      blankCond += v;
    }

    const typeKey = String(row.inv_custom_type || row.inv_type || '').trim();
    if (!typeKey || typeKey.toLowerCase() === 'other') otherType += v;

    const yr = String(row.inv_year || '').trim();
    if (!yr || yr === '0' || yr === '0000') year0 += v;

    const c = String(row.inv_condition || '').trim() || '(blank)';
    condMix.set(c, (condMix.get(c) || 0) + v);
    const t = typeKey || '(blank)';
    typeMix.set(t, (typeMix.get(t) || 0) + v);
  }

  const top = (map, n = 8) =>
    [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([name, views]) => ({ name, views }));

  const customFix = [];
  if (unknownViews > 0) {
    customFix.push({
      area: 'Unknown URL / make',
      views: unknownViews,
      note: 'Blank inv_url or blank/Other inv_make — needs path parse or inventory match',
    });
  }
  if (blankLoc > 0) {
    customFix.push({
      area: 'Location',
      views: blankLoc,
      note: 'Blank inv_location — set dealer default in smart_dealer_locations / fill',
    });
  }
  if (blankCond > 0) {
    customFix.push({
      area: 'Condition',
      views: blankCond,
      note: 'Blank/Other/Unknown inv_condition — New/Used/Pre-Owned fill needed',
    });
  }
  if (otherType > 0) {
    customFix.push({
      area: 'Type',
      views: otherType,
      note: 'Blank or literal Other type — fillers / heuristics / Hoot Vehicle Type',
    });
  }
  if (year0 > 0) {
    customFix.push({
      area: 'Year',
      views: year0,
      note: 'Missing or year 0 — parse from path or inventory',
    });
  }

  return {
    finalVdp,
    unknownViews,
    blankLoc,
    blankCond,
    otherType,
    year0,
    conditionMix: top(condMix),
    typeMix: top(typeMix),
    customFix,
  };
}

async function loadGa4Vdp(supabase, clientId, from, to) {
  const { data, error } = await supabase
    .from('smart_ga4_page_data')
    .select('views')
    .eq('client_id', clientId)
    .gte('report_date', from)
    .lte('report_date', to)
    .eq('vdp_conditions', true)
    .limit(500000);
  if (error) return { ga4Vdp: null, error: error.message };
  return { ga4Vdp: (data || []).reduce((s, r) => s + num(r.views), 0) };
}

/**
 * Full Step 4 dealer run:
 * sync logic_2 (if blank) → Step 2 → Step 3 → apply logic_2 path fill →
 * report + exceptions (true leftovers) + remaining custom-fix gaps.
 */
export async function runPipelineStep4(supabase, clientId, options = {}) {
  const { from: rangeFrom, to: rangeTo } = coerceDateRange(options.from, options.to);
  if (!rangeFrom || !rangeTo) {
    throw new Error('from and to are required for Step 4 run.');
  }

  const syncLogic2 = options.syncLogic2FromLive !== false;
  const runSteps23 = options.runSteps23 !== false;
  const applyFill = options.applyLogic2Fill !== false;
  const log = [
    `Step 4 run · dealer ${clientId} · ${rangeFrom} → ${rangeTo}`,
    `Options: syncLogic2FromLive=${syncLogic2}, runSteps23=${runSteps23}, applyLogic2Fill=${applyFill}`,
  ];

  let logic2Sync = null;
  if (syncLogic2) {
    log.push('— Logic 2 sync —');
    logic2Sync = await syncLogic2FromLive(supabase, clientId);
    log.push(...logic2Sync.log);
  }

  let filtration = null;
  let finalSync = null;
  if (runSteps23) {
    log.push('— Step 2 filtration —');
    filtration = await runVdpFiltration(supabase, clientId, {
      from: rangeFrom,
      to: rangeTo,
    });
    log.push(...(filtration.log || []));

    log.push('— Step 3 final VDP —');
    finalSync = await runFinalVdpSync(supabase, clientId, {
      from: rangeFrom,
      to: rangeTo,
    });
    log.push(...(finalSync.log || []));
  }

  let logic2Fill = null;
  if (applyFill) {
    log.push('— Logic 2 unknown fill (match → path parse → write back) —');
    logic2Fill = await applyLogic2UnknownFill(supabase, clientId, rangeFrom, rangeTo);
    log.push(...(logic2Fill.log || []));
  }

  log.push('— Post-run report —');
  const [ga4, unknowns, exceptions, gaps] = await Promise.all([
    loadGa4Vdp(supabase, clientId, rangeFrom, rangeTo),
    loadUnknownUrls(supabase, clientId, rangeFrom, rangeTo),
    loadExceptionUrls(supabase, clientId, rangeFrom, rangeTo),
    loadBreakdownGaps(supabase, clientId, rangeFrom, rangeTo),
  ]);

  log.push(
    `GA4 VDP views: ${ga4.ga4Vdp != null ? ga4.ga4Vdp.toLocaleString() : `n/a (${ga4.error || ''})`}`
  );
  log.push(`Final VDP views: ${gaps.finalVdp.toLocaleString()}`);
  if (ga4.ga4Vdp != null) {
    const delta = gaps.finalVdp - ga4.ga4Vdp;
    log.push(`Final − GA4 gap: ${delta.toLocaleString()}`);
  }
  log.push(
    `Remaining unknown URL/make: ${unknowns.uniqueUrls.toLocaleString()} path(s) · ${unknowns.totalViews.toLocaleString()} view(s)`
  );
  log.push(
    `Exceptions (do not match logic_2): ${exceptions.uniqueUrls.toLocaleString()} path(s) · ${exceptions.totalViews.toLocaleString()} view(s)`
  );
  log.push(`Blank location: ${gaps.blankLoc.toLocaleString()} views`);
  log.push(`Blank/Other condition: ${gaps.blankCond.toLocaleString()} views`);
  log.push(`Blank/Other type: ${gaps.otherType.toLocaleString()} views`);
  log.push(`Year 0 / blank: ${gaps.year0.toLocaleString()} views`);

  log.push('— Condition mix (top) —');
  for (const row of gaps.conditionMix) {
    log.push(`  ${row.views.toLocaleString().padStart(8)}  ${row.name}`);
  }
  log.push('— Type mix (top) —');
  for (const row of gaps.typeMix) {
    log.push(`  ${row.views.toLocaleString().padStart(8)}  ${row.name}`);
  }

  // Prefer exception leftovers as the primary "here is the issue" signal
  const issueFix = [];
  if (exceptions.uniqueUrls > 0) {
    issueFix.push({
      area: 'Exception URLs',
      views: exceptions.totalViews,
      note: `${exceptions.uniqueUrls} path(s) still unknown and do not match smart_vdp_logic_2 — widen logic_2 or fix manually`,
    });
  }
  for (const fix of gaps.customFix) {
    if (fix.area === 'Unknown URL / make' && exceptions.uniqueUrls > 0) {
      // Keep unknowns that matched logic_2 but still lack make/url after parse
      const matchedUnknownViews = Math.max(0, fix.views - exceptions.totalViews);
      if (matchedUnknownViews > 0) {
        issueFix.push({
          area: 'Matched logic_2 but still incomplete',
          views: matchedUnknownViews,
          note: 'Path matched logic_2 but make/url still blank after parse — needs custom path rule',
        });
      }
      continue;
    }
    issueFix.push(fix);
  }

  if (issueFix.length) {
    log.push('— Remaining issues —');
    for (const fix of issueFix) {
      log.push(`  [${fix.area}] ${fix.views.toLocaleString()} views — ${fix.note}`);
    }
  } else {
    log.push('— Remaining issues — none (clean for this range)');
  }

  if (exceptions.urls?.length) {
    log.push('— Top exception paths (do not match logic_2) —');
    for (const u of exceptions.urls.slice(0, 25)) {
      log.push(
        `  ${num(u.views).toLocaleString().padStart(8)} views · ${String(u.page_path || '')}`
      );
    }
    if (exceptions.urls.length > 25) {
      log.push(`  … +${exceptions.urls.length - 25} more`);
    }
  } else if (unknowns.urls?.length) {
    log.push('— Top remaining unknown paths (matched logic_2 but incomplete) —');
    for (const u of unknowns.urls.slice(0, 25)) {
      log.push(
        `  ${num(u.views).toLocaleString().padStart(8)} views · ${String(u.page_path || '')}`
      );
    }
  }

  return {
    success: true,
    step: 4,
    clientId,
    from: rangeFrom,
    to: rangeTo,
    logic2Sync,
    logic2Fill,
    filtration: filtration
      ? {
          totalRowsUpdated: filtration.totalRowsUpdated,
        }
      : null,
    finalSync: finalSync
      ? {
          totalRows: finalSync.totalRows,
          vdpTrueRows: finalSync.totalVdpTrue,
        }
      : null,
    report: {
      ga4Vdp: ga4.ga4Vdp,
      finalVdp: gaps.finalVdp,
      gap: ga4.ga4Vdp != null ? gaps.finalVdp - ga4.ga4Vdp : null,
      unknowns,
      exceptions,
      blankLoc: gaps.blankLoc,
      blankCond: gaps.blankCond,
      otherType: gaps.otherType,
      year0: gaps.year0,
      conditionMix: gaps.conditionMix,
      typeMix: gaps.typeMix,
    },
    customFix: issueFix,
    log,
  };
}
