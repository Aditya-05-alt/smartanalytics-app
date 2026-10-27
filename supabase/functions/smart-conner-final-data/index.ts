import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RPC = "build_smart_final_data_conner";

/** Edge wall-clock limit is 150s; leave room to report back. */
const GLOBAL_BUDGET_MS = 140_000;
/** Do not claim a new dealer with less time than this left. */
const MIN_CLAIM_MS = 30_000;
const MAX_ATTEMPTS = 4;
const QUEUE_KIND = "conner";
/** Runs alongside the Hoot / Scrap workers; keep parallel builds low enough for the gateway timeout. */
const MAX_QUEUE_WORKERS = 3;

/** 7-day builds for these exceed the gateway timeout; always build one day per call. */
const HEAVY_CLIENT_IDS = new Set([
  "2728830488", // A&L RV Sales
  "1162028739", // Gerzeny's RV
]);

type DealerResult = {
  client_id: string;
  status: "done" | "partial" | "error";
  account_name?: string | null;
  rows?: number;
  matched?: number;
  next_day?: string | null;
  error?: string;
};

class DayBuildError extends Error {
  constructor(readonly day: string, message: string) {
    super(`${day}: ${message}`);
  }
}

function utcDay(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function enumerateDays(from: string, to: string): string[] {
  const days: string[] = [];
  const cur = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cur <= end) {
    days.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function formatErr(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

async function buildRange(
  supabase: SupabaseClient,
  clientId: string,
  from: string,
  to: string,
  dryRun: boolean,
) {
  const { data, error } = await supabase.rpc(RPC, {
    p_client_id: clientId,
    p_days_back: null,
    p_date_from: from,
    p_date_to: to,
    p_dry_run: dryRun,
  });
  if (error) throw new Error(error.message);
  const row = (data as Record<string, unknown>[] | null)?.[0];
  return {
    rows: Number(row?.out_total_rows) || 0,
    matched: Number(row?.out_matched_rows) || 0,
    accountName: (row?.account_name as string) ?? null,
  };
}

async function buildDealer(
  supabase: SupabaseClient,
  clientId: string,
  from: string,
  to: string,
  dryRun: boolean,
  deadline: number,
  dayByDay = HEAVY_CLIENT_IDS.has(clientId),
  resumeDay: string | null = null,
): Promise<DealerResult> {
  if (!dayByDay && !resumeDay) {
    const r = await buildRange(supabase, clientId, from, to, dryRun);
    return { client_id: clientId, status: "done", account_name: r.accountName, rows: r.rows, matched: r.matched };
  }

  const result: DealerResult = { client_id: clientId, status: "done", account_name: null, rows: 0, matched: 0 };
  for (const day of enumerateDays(from, to)) {
    if (resumeDay && day < resumeDay) continue;
    if (Date.now() > deadline) {
      return { ...result, status: "partial", next_day: day };
    }
    try {
      const r = await buildRange(supabase, clientId, day, day, dryRun);
      result.rows! += r.rows;
      result.matched! += r.matched;
      result.account_name ??= r.accountName;
    } catch (err) {
      throw new DayBuildError(day, formatErr(err));
    }
  }
  return result;
}

/**
 * Step 2 normally finishes before Step 3; re-tag only when rows in the rebuild window are untagged.
 * GA4 re-syncs a day ~5 days later (resetting its tags), so check the whole window, not just 2 days.
 */
async function ensureTagged(supabase: SupabaseClient, clientId: string, daysBack: number): Promise<boolean> {
  const { data: needs, error } = await supabase.rpc("step3_needs_tagging", {
    p_client_id: clientId,
    p_days_back: daysBack,
  });
  if (error || !needs) return false;
  const { error: filtErr } = await supabase.rpc("apply_vdp_filtration", {
    p_client_id: clientId,
    p_days_back: daysBack,
  });
  if (filtErr) throw new Error(`apply_vdp_filtration: ${filtErr.message}`);
  return true;
}

/** Dealers with an active Conner feed (Scout RV / ScoutX VLA feeds). */
async function loadConnerClientIds(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase.rpc("get_conner_dealers_for_sync", { p_client_id: null });
  if (error) throw new Error(`get_conner_dealers_for_sync: ${error.message}`);
  return [
    ...new Set(
      ((data as { ga4_customer_id?: string }[]) || [])
        .map((d) => String(d.ga4_customer_id ?? "").trim())
        .filter(Boolean),
    ),
  ].sort();
}

/** Cron: pull Conner dealers from the smart_step3_runs queue until the time budget runs out (writes). */
async function runQueueWorker(
  supabase: SupabaseClient,
  body: Record<string, unknown>,
  startTime: number,
  deadline: number,
): Promise<Response> {
  const groupId = Number(body?.group_id) || 1;
  if (groupId > MAX_QUEUE_WORKERS) {
    return json({ success: true, rpc: RPC, skipped: `group ${groupId} > ${MAX_QUEUE_WORKERS} workers` }, 200);
  }

  const daysBack = body?.days_back != null ? Number(body.days_back) : 7;
  const from = utcDay(-daysBack);
  const to = utcDay(0);
  const clientIds = await loadConnerClientIds(supabase);
  const worker = `conner-${body?.group_id ?? "x"}-${crypto.randomUUID().slice(0, 8)}`;
  console.log(`🧹 Conner Step 3 queue worker ${worker} (${clientIds.length} dealers, ${from}..${to})`);

  const processed: Record<string, unknown>[] = [];
  let totalRows = 0;

  while (clientIds.length && deadline - Date.now() > MIN_CLAIM_MS) {
    const { data: claimed, error: claimErr } = await supabase.rpc("claim_step3_dealer", {
      p_kind: QUEUE_KIND,
      p_client_ids: clientIds,
      p_worker: worker,
      p_lease_seconds: 300,
      p_max_attempts: MAX_ATTEMPTS,
    });
    if (claimErr) throw new Error(`claim_step3_dealer: ${claimErr.message}`);
    const claim = (claimed as Record<string, unknown>[] | null)?.[0];
    if (!claim) break;

    const clientId = String(claim.client_id);
    const attempt = Number(claim.attempts) || 1;
    const resumeDay = claim.resume_day ? String(claim.resume_day) : null;
    const dayByDay = HEAVY_CLIENT_IDS.has(clientId) || attempt > 1 || resumeDay !== null;
    const mode = dayByDay ? "per-day" : "full";
    const t0 = Date.now();

    try {
      const retagged = await ensureTagged(supabase, clientId, daysBack);
      const built = await buildDealer(supabase, clientId, from, to, false, deadline, dayByDay, resumeDay);

      if (built.status === "partial") {
        await supabase.rpc("finish_step3_dealer", {
          p_client_id: clientId,
          p_status: "pending",
          p_total_rows: built.rows,
          p_resume_day: built.next_day,
        });
        console.log(`⏱️ [${clientId}] budget reached mid-dealer — resumes from ${built.next_day} next round`);
        processed.push({ client_id: clientId, status: "released" });
        break;
      }

      await supabase.rpc("finish_step3_dealer", {
        p_client_id: clientId,
        p_status: "done",
        p_total_rows: built.rows,
        p_mode: mode,
      });
      totalRows += built.rows ?? 0;
      console.log(
        `  ✅ ${built.account_name ?? clientId} | ${built.rows} rows | matched ${built.matched} | ${mode}${retagged ? " +retag" : ""} | ${((Date.now() - t0) / 1000).toFixed(1)}s`,
      );
      processed.push({ client_id: clientId, status: "done", rows: built.rows, matched: built.matched, mode, attempt });
    } catch (err) {
      const message = formatErr(err);
      await supabase.rpc("finish_step3_dealer", {
        p_client_id: clientId,
        p_status: "error",
        p_error: message.slice(0, 500),
        p_mode: mode,
        p_resume_day: err instanceof DayBuildError ? err.day : null,
      });
      console.error(`❌ [${clientId}] attempt ${attempt} (${mode}): ${message}`);
      processed.push({ client_id: clientId, status: "error", error: message, mode, attempt });
    }
  }

  console.log(`📊 Conner worker ${worker} done — ${processed.length} dealers | ${totalRows} rows | ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
  const ok = processed.every((p) => p.status !== "error");
  return json({
    success: ok,
    rpc: RPC,
    worker,
    from,
    to,
    total_dealers: clientIds.length,
    processed_dealers: processed.length,
    totalRows,
    processed,
  }, ok ? 200 : 207);
}

/**
 * Conner Step 3 — build_smart_final_data_conner (inventory from smart_conner_inventory).
 *
 * Cron: { queue: true, group_id } — queue worker over every active Conner dealer, writes Final.
 *
 * Manual body:
 *   client_id   — one dealer, or
 *   client_ids  — several dealers, or
 *   all_conner  — true to run every active dealer with a Conner feed
 *   days_back   — default 7, or date_from / date_to (YYYY-MM-DD)
 *   write       — must be true to write smart_final_data; otherwise a dry run (counts only)
 *   run_step2   — with write:true, run apply_vdp_filtration_range first (default true)
 *
 * Report dates before a dealer's first Conner snapshot are never rebuilt (see the RPC).
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startTime = Date.now();
  const deadline = startTime + GLOBAL_BUDGET_MS - 10_000;
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    /* no body */
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    if (body?.queue === true) {
      return await runQueueWorker(supabase, body, startTime, deadline);
    }

    const write = body?.write === true;
    const dryRun = !write;
    const runStep2 = write && body?.run_step2 !== false;
    const daysBack = body?.days_back != null ? Number(body.days_back) : 7;
    const from = body?.date_from ? String(body.date_from).slice(0, 10) : utcDay(-daysBack);
    const to = body?.date_to ? String(body.date_to).slice(0, 10) : utcDay(0);

    let clientIds: string[];
    if (body?.client_id) {
      clientIds = [String(body.client_id).trim()];
    } else if (Array.isArray(body?.client_ids)) {
      clientIds = (body.client_ids as unknown[]).map((v) => String(v).trim()).filter(Boolean);
    } else if (body?.all_conner === true) {
      clientIds = await loadConnerClientIds(supabase);
    } else {
      return json({ success: false, error: "Pass client_id, client_ids, all_conner:true, or queue:true" }, 400);
    }

    console.log(
      `🧹 Conner Step 3 (${dryRun ? "DRY RUN" : "WRITE"}) ${clientIds.length} dealer(s) ${from}..${to}`,
    );

    const processed: DealerResult[] = [];
    const remaining: string[] = [];

    for (const clientId of clientIds) {
      if (Date.now() > deadline) {
        remaining.push(clientId);
        continue;
      }
      try {
        if (runStep2) {
          const { error: filtErr } = await supabase.rpc("apply_vdp_filtration_range", {
            p_client_id: clientId,
            p_from: from,
            p_to: to,
          });
          if (filtErr) throw new Error(`apply_vdp_filtration_range: ${filtErr.message}`);
        }
        const r = await buildDealer(supabase, clientId, from, to, dryRun, deadline);
        console.log(
          `  ${r.status === "done" ? "✅" : "⏱️"} ${r.account_name ?? clientId} | ${r.rows} rows | matched ${r.matched}${r.next_day ? ` | stopped at ${r.next_day}` : ""}`,
        );
        processed.push(r);
      } catch (err) {
        const message = formatErr(err);
        console.error(`❌ [${clientId}] ${message}`);
        processed.push({ client_id: clientId, status: "error", error: message });
      }
    }

    const ok = processed.every((p) => p.status !== "error") && remaining.length === 0;
    return json({
      success: ok,
      rpc: RPC,
      dry_run: dryRun,
      from,
      to,
      processed,
      remaining,
      seconds: Math.round((Date.now() - startTime) / 1000),
    }, ok ? 200 : 207);
  } catch (err) {
    const message = formatErr(err);
    console.error("❌ Conner Step 3 error:", message);
    return json({ success: false, rpc: RPC, error: message }, 500);
  }
});
