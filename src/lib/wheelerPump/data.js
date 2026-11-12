'use client';

/*
 * Wheeler Pump reads/writes (ported from the wheeler-pump app's src/lib/data.ts).
 * Uses the signed-in user's browser session, so Wheeler Pump's row-level security
 * (wheeler_pump_memberships) still decides what each user can see and change.
 */
import { createClient } from '@/lib/supabase/client';
import { calcQuarters } from './calc';

let client = null;
export function wheelerPumpSupabase() {
  if (!client) client = createClient();
  if (!client) throw new Error('Supabase is not configured');
  return client;
}

/** Supabase returns at most 1000 rows per request; page through. */
async function fetchAll(table, select, clientId) {
  const supabase = wheelerPumpSupabase();
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(select).eq('client_id', clientId).range(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** The signed-in user's Wheeler Pump roles: wheeler_admin / wheeler see every client, client sees its own. */
export async function loadMemberships() {
  const supabase = wheelerPumpSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return [];
  const { data, error } = await supabase
    .from('wheeler_pump_memberships')
    .select('role, client_id')
    .eq('user_id', auth.user.id);
  if (error) throw error;
  return data ?? [];
}

export async function loadClients() {
  const { data, error } = await wheelerPumpSupabase()
    .from('wheeler_pump_clients')
    .select('id, slug, name, locations')
    .order('name');
  if (error) throw error;
  return data ?? [];
}

export async function addClient(name, locations) {
  const slugValue = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const { error } = await wheelerPumpSupabase().from('wheeler_pump_clients').insert({ name, slug: slugValue, locations });
  if (error) {
    throw new Error(error.code === '23505' ? 'A client with that name already exists.' : error.message);
  }
}

export async function loadClientData(clientId) {
  const supabase = wheelerPumpSupabase();
  const [q, qd, r, rd, m, md, notes, ups] = await Promise.all([
    fetchAll('wheeler_pump_quarterly', 'quarter, location, brand, line, local_sales, pumped_in, pumped_out, source', clientId),
    fetchAll('wheeler_pump_quarterly_dealers', 'quarter, location, brand, direction, name, units', clientId),
    fetchAll('wheeler_pump_r12', 'period_end, period_start, location, brand, line, local_sales, pumped_in, pumped_out, source', clientId),
    fetchAll('wheeler_pump_r12_dealers', 'period_end, location, brand, direction, name, units', clientId),
    fetchAll('wheeler_pump_monthly', 'month, location, brand, line, local_sales, pumped_in, pumped_out, source', clientId),
    fetchAll('wheeler_pump_monthly_dealers', 'month, location, brand, direction, name, units', clientId),
    fetchAll('wheeler_pump_notes', '*', clientId),
    supabase
      .from('wheeler_pump_uploads')
      .select('id, label, created_at, files, quarters, r12_ends, months, brands, row_count, skipped, warnings, created_by')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(50),
  ]);
  if (ups.error) throw ups.error;

  const real = q.map((x) => ({
    quarter: x.quarter, location: x.location, brand: x.brand, line: x.line,
    local: x.local_sales, pin: x.pumped_in, pout: x.pumped_out, source: x.source,
  }));
  const r12 = r.map((x) => ({
    end: x.period_end, start: x.period_start, location: x.location, brand: x.brand, line: x.line,
    local: x.local_sales, pin: x.pumped_in, pout: x.pumped_out, source: x.source,
  }));
  return {
    q: [...real, ...calcQuarters(real, r12)],
    qd: qd.map((x) => ({ quarter: x.quarter, location: x.location, brand: x.brand, dir: x.direction, name: x.name, units: x.units })),
    r: r12,
    rd: rd.map((x) => ({ end: x.period_end, location: x.location, brand: x.brand, dir: x.direction, name: x.name, units: x.units })),
    m: m.map((x) => ({
      month: x.month, location: x.location, brand: x.brand, line: x.line,
      local: x.local_sales, pin: x.pumped_in, pout: x.pumped_out, source: x.source,
    })),
    md: md.map((x) => ({ month: x.month, location: x.location, brand: x.brand, dir: x.direction, name: x.name, units: x.units })),
    notes,
    uploads: ups.data ?? [],
  };
}

export async function saveReview(clientId, rev) {
  const { data, error } = await wheelerPumpSupabase().rpc('save_report_rows', {
    p_client: clientId,
    p_upload: { files: rev.files, skipped: rev.skipped.slice(0, 40), warnings: rev.warn.slice(0, 40) },
    p_quarterly: rev.sum.map(({ quarter, location, brand, line, local, pin, pout, source }) => (
      { quarter, location, brand, line, local, pin, pout, source }
    )),
    p_quarterly_dealers: rev.dl,
    p_r12: rev.rsum,
    p_r12_dealers: rev.rdl,
    p_monthly: rev.msum ?? [],
    p_monthly_dealers: rev.mdl ?? [],
  });
  if (error) throw error;
  return data;
}

/** Remove one brand's rows for one period at one store. */
export async function deleteGroup(clientId, kind, period, location, brand) {
  const [t1, t2, col] = {
    q: ['wheeler_pump_quarterly', 'wheeler_pump_quarterly_dealers', 'quarter'],
    r: ['wheeler_pump_r12', 'wheeler_pump_r12_dealers', 'period_end'],
    m: ['wheeler_pump_monthly', 'wheeler_pump_monthly_dealers', 'month'],
  }[kind];
  const supabase = wheelerPumpSupabase();
  for (const t of [t1, t2]) {
    const { error } = await supabase.from(t).delete()
      .eq('client_id', clientId).eq(col, period).eq('location', location).eq('brand', brand);
    if (error) throw error;
  }
}

export async function addNote(note) {
  const { error } = await wheelerPumpSupabase().from('wheeler_pump_notes').insert(note);
  if (error) throw error;
}

export async function deleteNote(id) {
  const { error } = await wheelerPumpSupabase().from('wheeler_pump_notes').delete().eq('id', id);
  if (error) throw error;
}

export async function setNoteVisibility(id, visibility) {
  const { error } = await wheelerPumpSupabase().from('wheeler_pump_notes').update({ visibility }).eq('id', id);
  if (error) throw error;
}

/** Upload an original report to private storage under <client_id>/ */
export async function uploadReportFile(clientId, file) {
  const safe = file.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-120);
  const path = `${clientId}/${crypto.randomUUID()}-${safe}`;
  const { error } = await wheelerPumpSupabase().storage
    .from('wheeler_pump_reports')
    .upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (error) throw error;
  return path;
}

export async function reportFileUrl(path) {
  const { data } = await wheelerPumpSupabase().storage.from('wheeler_pump_reports').createSignedUrl(path, 60 * 10);
  return data?.signedUrl ?? null;
}

/** Reads an uploaded OEM PDF/image with Claude (Supabase edge function `extract-report`). */
export async function extractReport(clientId, location, path, fileName) {
  const { data, error } = await wheelerPumpSupabase().functions.invoke('extract-report', {
    body: { clientId, location, path, fileName },
  });
  if (error) {
    let msg = error.message;
    let body = null;
    try {
      body = await error.context?.json();
    } catch {
      /* the function returned no JSON body */
    }
    if (body?.error) msg = body.error;
    else if (error.name === 'FunctionsFetchError' || error.name === 'FunctionsRelayError') {
      msg = "Couldn't reach the PDF reader (extract-report). Try again, or upload a CSV / Excel file instead.";
    }
    throw new Error(msg);
  }
  return data;
}
