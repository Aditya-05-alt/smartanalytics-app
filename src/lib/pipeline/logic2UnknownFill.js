import {
  buildMakeSlugs,
  pagePathMatchesVdpLogic,
  parseVdpPath,
} from '@/lib/pipeline/logic2PathParse';

function num(v) {
  return Number(v) || 0;
}

function blank(v) {
  return !String(v ?? '').trim();
}

function isBlankOrOther(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return !s || s === 'other' || s === 'unknown';
}

function coalesceText(existing, next) {
  if (!blank(existing) && !isBlankOrOther(existing)) return existing;
  if (!blank(next) && !isBlankOrOther(next)) return next;
  if (!blank(existing)) return existing;
  return next ?? existing ?? null;
}

/**
 * Apply smart_vdp_logic_2 to Unknown/Other final rows for one dealer/range:
 * match logic_2 → path-parse inv_* → set inv_url + vdp_conditions.
 * Leftovers that do not match remain for Exception (E).
 */
export async function applyLogic2UnknownFill(supabase, clientId, from, to, options = {}) {
  const log = [];
  const { data: logic2, error: logicErr } = await supabase
    .from('smart_vdp_logic_2')
    .select('dealer_id, dealer_name, cms, website_url, vdp_logic')
    .eq('dealer_id', clientId)
    .maybeSingle();

  if (logicErr) throw new Error(logicErr.message || 'Failed to read smart_vdp_logic_2');
  if (!logic2) {
    log.push('No smart_vdp_logic_2 row — skip logic_2 fill (add dealer to logic_2 first)');
    return {
      applied: false,
      reason: 'no_logic2_row',
      matchedPaths: 0,
      updatedFinalRows: 0,
      updatedGa4Rows: 0,
      locationFilled: 0,
      typeFilled: 0,
      exceptionCandidates: 0,
      log,
    };
  }

  const vdpLogic = String(logic2.vdp_logic || '').trim();
  if (!vdpLogic) {
    log.push('smart_vdp_logic_2.vdp_logic is blank — skip fill (upload a pattern first)');
    return {
      applied: false,
      reason: 'blank_logic',
      matchedPaths: 0,
      updatedFinalRows: 0,
      updatedGa4Rows: 0,
      locationFilled: 0,
      typeFilled: 0,
      exceptionCandidates: 0,
      log,
    };
  }

  log.push(
    `Logic_2 fill · ${logic2.dealer_name || clientId} · cms=${logic2.cms || 'n/a'}`
  );
  log.push(`Pattern: ${vdpLogic.slice(0, 140)}${vdpLogic.length > 140 ? '…' : ''}`);

  const { data: unknownRows, error: unkErr } = await supabase.rpc(
    'get_pipeline_unknown_urls',
    {
      p_client_id: clientId,
      p_from: from,
      p_to: to,
    }
  );
  if (unkErr) throw new Error(unkErr.message || 'Failed to load unknown URLs for fill');

  const unknowns = Array.isArray(unknownRows) ? unknownRows : [];
  const matched = [];
  const exceptions = [];
  for (const u of unknowns) {
    const path = String(u.page_path || '').trim();
    if (!path) continue;
    if (pagePathMatchesVdpLogic(path, vdpLogic)) matched.push(u);
    else exceptions.push(u);
  }

  log.push(
    `Unknown paths: ${unknowns.length} · match logic_2: ${matched.length} · exceptions: ${exceptions.length}`
  );

  let makeSlugs = [];
  const cms = String(logic2.cms || '').trim();
  if (cms) {
    const { data: makes } = await supabase
      .from('smart_make')
      .select('make')
      .eq('cms', cms)
      .limit(5000);
    makeSlugs = buildMakeSlugs(makes || []);
    log.push(`Make catalog (${cms}): ${makeSlugs.length} slug(s)`);
  }

  let updatedFinalRows = 0;
  let updatedGa4Rows = 0;
  const parserCounts = new Map();
  const PATH_CHUNK = 40;

  for (let i = 0; i < matched.length; i += PATH_CHUNK) {
    const chunk = matched.slice(i, i + PATH_CHUNK);
    for (const u of chunk) {
      const path = String(u.page_path || '').trim();
      const parsed = parseVdpPath(path, { makeSlugs });
      parserCounts.set(parsed.parser || 'url_only', (parserCounts.get(parsed.parser) || 0) + 1);

      const invUrl =
        String(u.page_location || '').trim() ||
        (logic2.website_url
          ? `${String(logic2.website_url).replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`
          : path);

      // Load current rows for this path in range (capped) to coalesce blank-only fills
      const { data: rows, error: rowErr } = await supabase
        .from('smart_final_data')
        .select(
          'id, inv_url, inv_make, inv_model, inv_year, inv_condition, inv_type, inv_custom_type, inv_stock_number, vdp_conditions, page_location'
        )
        .eq('client_id', clientId)
        .eq('page_path', path)
        .gte('report_date', from)
        .lte('report_date', to)
        .limit(5000);

      if (rowErr) throw new Error(rowErr.message || `Failed reading path ${path}`);

      const idsToTouch = [];
      const patchesById = new Map();

      for (const row of rows || []) {
        const needs =
          blank(row.inv_url) ||
          row.vdp_conditions !== true ||
          isBlankOrOther(row.inv_make);

        if (!needs && !blank(row.inv_year) && !isBlankOrOther(row.inv_condition)) {
          continue;
        }

        const patch = {
          inv_url: coalesceText(row.inv_url, invUrl || row.page_location || path),
          vdp_conditions: true,
          inv_condition: coalesceText(row.inv_condition, parsed.condition),
          inv_year: coalesceText(
            row.inv_year && String(row.inv_year) !== '0' ? row.inv_year : null,
            parsed.year
          ),
          inv_make: coalesceText(row.inv_make, parsed.make),
          inv_model: coalesceText(row.inv_model, parsed.model),
          inv_stock_number: coalesceText(row.inv_stock_number, parsed.stock),
        };

        // Only include changed keys + always vdp/url when needed
        const changed = {};
        if (blank(row.inv_url) || row.vdp_conditions !== true) {
          changed.inv_url = patch.inv_url;
          changed.vdp_conditions = true;
        }
        if (isBlankOrOther(row.inv_make) && patch.inv_make) changed.inv_make = patch.inv_make;
        if (blank(row.inv_model) && patch.inv_model) changed.inv_model = patch.inv_model;
        if (
          (blank(row.inv_year) || String(row.inv_year) === '0') &&
          patch.inv_year
        ) {
          changed.inv_year = patch.inv_year;
        }
        if (isBlankOrOther(row.inv_condition) && patch.inv_condition) {
          changed.inv_condition = patch.inv_condition;
        }
        if (blank(row.inv_stock_number) && patch.inv_stock_number) {
          changed.inv_stock_number = patch.inv_stock_number;
        }

        if (Object.keys(changed).length) {
          idsToTouch.push(row.id);
          patchesById.set(row.id, changed);
        }
      }

      // Group identical patches for fewer round-trips
      const groups = new Map();
      for (const id of idsToTouch) {
        const p = patchesById.get(id);
        const key = JSON.stringify(p);
        if (!groups.has(key)) groups.set(key, { patch: p, ids: [] });
        groups.get(key).ids.push(id);
      }

      for (const { patch, ids } of groups.values()) {
        for (let j = 0; j < ids.length; j += 200) {
          const idChunk = ids.slice(j, j + 200);
          const { error: updErr, count } = await supabase
            .from('smart_final_data')
            .update(patch, { count: 'exact' })
            .in('id', idChunk);
          if (updErr) throw new Error(updErr.message || `Update failed for ${path}`);
          updatedFinalRows += count ?? idChunk.length;
        }
      }

      // Mark matching GA4 paths as VDP
      const { error: ga4Err, count: ga4Count } = await supabase
        .from('smart_ga4_page_data')
        .update({ vdp_conditions: true }, { count: 'exact' })
        .eq('client_id', clientId)
        .eq('page_path', path)
        .gte('report_date', from)
        .lte('report_date', to)
        .or('vdp_conditions.is.null,vdp_conditions.eq.false');
      if (!ga4Err) updatedGa4Rows += ga4Count ?? 0;
    }

    if (options.onProgress) {
      options.onProgress({
        done: Math.min(i + PATH_CHUNK, matched.length),
        total: matched.length,
      });
    }
  }

  for (const [parser, n] of [...parserCounts.entries()].sort((a, b) => b[1] - a[1])) {
    log.push(`  parser ${parser}: ${n} path(s)`);
  }
  log.push(
    `Updated final rows: ${updatedFinalRows.toLocaleString()} · GA4 VDP flags: ${updatedGa4Rows.toLocaleString()}`
  );

  // Default location when dealer has exactly one location
  let locationFilled = 0;
  const { data: locs } = await supabase
    .from('smart_dealer_locations')
    .select('location_name')
    .eq('customer_id', clientId)
    .limit(5);
  if ((locs || []).length === 1 && locs[0].location_name) {
    const locName = String(locs[0].location_name).trim();
    const { data: blankLocRows } = await supabase
      .from('smart_final_data')
      .select('id')
      .eq('client_id', clientId)
      .gte('report_date', from)
      .lte('report_date', to)
      .eq('vdp_conditions', true)
      .or('inv_location.is.null,inv_location.eq.')
      .limit(20000);
    const ids = (blankLocRows || []).map((r) => r.id).filter(Boolean);
    for (let j = 0; j < ids.length; j += 200) {
      const idChunk = ids.slice(j, j + 200);
      const { error, count } = await supabase
        .from('smart_final_data')
        .update({ inv_location: locName }, { count: 'exact' })
        .in('id', idChunk);
      if (!error) locationFilled += count ?? idChunk.length;
    }
    if (locationFilled) {
      log.push(`Location fill → "${locName}": ${locationFilled.toLocaleString()} row(s)`);
    }
  }

  // Type fill via smart_custom_unknown_fillers when cms is known
  let typeFilled = 0;
  if (cms) {
    const { data: fillers } = await supabase
      .from('smart_custom_unknown_fillers')
      .select('make, model, type')
      .eq('cms', cms)
      .limit(10000);
    if ((fillers || []).length) {
      const { data: needType } = await supabase
        .from('smart_final_data')
        .select('id, inv_make, inv_model, inv_type, inv_custom_type')
        .eq('client_id', clientId)
        .gte('report_date', from)
        .lte('report_date', to)
        .eq('vdp_conditions', true)
        .limit(50000);

      const fillerIndex = (fillers || []).map((f) => ({
        make: String(f.make || '').trim().toLowerCase(),
        model: String(f.model || '').trim().toLowerCase(),
        type: String(f.type || '').trim(),
      }));

      const byType = new Map();
      for (const row of needType || []) {
        const makeL = String(row.inv_make || '').trim().toLowerCase();
        const modelL = String(row.inv_model || '').trim().toLowerCase();
        const typeBlank =
          blank(row.inv_type) ||
          blank(row.inv_custom_type) ||
          isBlankOrOther(row.inv_type) ||
          isBlankOrOther(row.inv_custom_type);
        if (!typeBlank || !makeL) continue;
        const hit = fillerIndex.find(
          (f) =>
            f.make === makeL &&
            f.type &&
            (f.model === modelL ||
              modelL.startsWith(`${f.model} `) ||
              f.model.startsWith(modelL))
        );
        if (!hit) continue;
        if (!byType.has(hit.type)) byType.set(hit.type, []);
        byType.get(hit.type).push(row.id);
      }

      for (const [type, ids] of byType) {
        for (let j = 0; j < ids.length; j += 200) {
          const idChunk = ids.slice(j, j + 200);
          const { error, count } = await supabase
            .from('smart_final_data')
            .update(
              { inv_type: type, inv_custom_type: type },
              { count: 'exact' }
            )
            .in('id', idChunk);
          if (!error) typeFilled += count ?? idChunk.length;
        }
      }
      if (typeFilled) {
        log.push(`Type filler (${cms}): ${typeFilled.toLocaleString()} row(s)`);
      }
    }
  }

  const matchedViews = matched.reduce((s, u) => s + num(u.views), 0);
  const exceptionViews = exceptions.reduce((s, u) => s + num(u.views), 0);
  log.push(
    `Matched views fixed attempt: ${matchedViews.toLocaleString()} · leftover exception views: ${exceptionViews.toLocaleString()}`
  );

  return {
    applied: true,
    reason: 'ok',
    matchedPaths: matched.length,
    matchedViews,
    exceptionCandidates: exceptions.length,
    exceptionViews,
    updatedFinalRows,
    updatedGa4Rows,
    locationFilled,
    typeFilled,
    parserCounts: Object.fromEntries(parserCounts),
    log,
  };
}
