import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GLOBAL_BUDGET_MS = 140_000;
const MIN_CLAIM_MS = 30_000;
const MAX_ATTEMPTS = 4;
const QUEUE_KIND = "scrap";
/** Runs alongside the hoot workers; keep total parallel builds low enough to stay under the gateway timeout. */
const MAX_QUEUE_WORKERS = 3;
const RPC = "build_smart_final_data_scrap";

type RpcRow = Record<string, unknown>;

/** nextDay: first day not yet built when outOfBudget. */
type BuildResult = { rows: number; vdp: number; outOfBudget: boolean; nextDay: string | null };

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

function formatErr(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

function sumBuildRows(data: unknown) {
  const rows = (data as RpcRow[] | null) || [];
  return {
    rows: rows.reduce((s, r) => s + (Number(r.out_total_rows) || 0), 0),
    vdp: rows.reduce((s, r) => s + (Number(r.out_vdp_true_rows) || 0), 0),
  };
}

async function buildDealer(
  supabase: SupabaseClient,
  clientId: string,
  daysBack: number,
  dayByDay: boolean,
  deadline: number,
  resumeDay: string | null = null,
): Promise<BuildResult> {
  if (!dayByDay && !resumeDay) {
    const { data, error } = await supabase.rpc(RPC, {
      p_client_id: clientId,
      p_days_back: daysBack,
      p_date_from: null,
      p_date_to: null,
    });
    if (error) throw new Error(error.message);
    return { ...sumBuildRows(data), outOfBudget: false, nextDay: null };
  }

  const result: BuildResult = { rows: 0, vdp: 0, outOfBudget: false, nextDay: null };
  for (let offset = -daysBack; offset <= 0; offset++) {
    const day = utcDay(offset);
    if (resumeDay && day < resumeDay) continue;
    if (Date.now() > deadline) {
      result.outOfBudget = true;
      result.nextDay = day;
      return result;
    }
    const { data, error } = await supabase.rpc(RPC, {
      p_client_id: clientId,
      p_days_back: null,
      p_date_from: day,
      p_date_to: day,
    });
    if (error) throw new DayBuildError(day, error.message);
    const dayTotals = sumBuildRows(data);
    result.rows += dayTotals.rows;
    result.vdp += dayTotals.vdp;
  }
  return result;
}

/** Step 2 normally finishes before Step 3; only re-tag a dealer whose recent rows are untagged. */
async function ensureTagged(supabase: SupabaseClient, clientId: string): Promise<boolean> {
  const { data: needs, error } = await supabase.rpc("step3_needs_tagging", {
    p_client_id: clientId,
    p_days_back: 2,
  });
  if (error || !needs) return false;
  const { error: filtErr } = await supabase.rpc("apply_vdp_filtration", {
    p_client_id: clientId,
    p_days_back: 2,
  });
  if (filtErr) throw new Error(`apply_vdp_filtration: ${filtErr.message}`);
  return true;
}

async function loadScrapDealers(
  supabase: SupabaseClient,
  onlyClientId: string | null,
): Promise<{ clientIds: string[]; dealers: RpcRow[] }> {
  const { data, error } = await supabase.rpc("get_scrap_dealers_for_sync", {
    p_client_id: onlyClientId,
  });
  if (error) {
    throw new Error(
      `${error.message} — deploy supabase/rpc/get_scrap_dealers_for_sync.sql`,
    );
  }
  const dealers = (data || []) as RpcRow[];
  const clientIds = [
    ...new Set(
      dealers
        .map((d) => String(d.ga4_customer_id ?? "").trim())
        .filter(Boolean),
    ),
  ];
  return { clientIds, dealers };
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Scrap Step 3 — build_smart_final_data_scrap for scrap_link=on dealers.
 *
 * Cron (no client_id): pulls dealers from the smart_step3_runs queue one at a
 * time until the time budget runs out; retry rounds continue with dealers not
 * yet done tonight. group_id / group_count / run_step2 are ignored here.
 *
 * Manual (client_id): builds that dealer directly, running Step 2 first unless
 * run_step2:false.
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

  const onlyClientId: string | null = body?.client_id
    ? String(body.client_id).trim()
    : null;
  const daysBack: number =
    body?.days_back != null ? Number(body.days_back) : 5;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { clientIds, dealers } = await loadScrapDealers(supabase, onlyClientId);
    const labelOf = (clientId: string) =>
      String(
        dealers.find((d) => String(d.ga4_customer_id).trim() === clientId)
          ?.customer_name ?? clientId,
      );

    if (onlyClientId) {
      const runStep2 = body?.run_step2 !== false;
      console.log(`🧹 Scrap Step 3 manual for ${labelOf(onlyClientId)} (days_back=${daysBack}, run_step2=${runStep2})`);
      if (runStep2) {
        const { error: filtErr } = await supabase.rpc("apply_vdp_filtration", {
          p_client_id: onlyClientId,
          p_days_back: daysBack,
        });
        if (filtErr) throw new Error(`Step2: ${filtErr.message}`);
      }
      const built = await buildDealer(supabase, onlyClientId, daysBack, false, Number.POSITIVE_INFINITY);
      console.log(`  ✅ ${labelOf(onlyClientId)} | ${built.rows} rows | VDP=TRUE ${built.vdp}`);
      return json({
        success: true,
        rpc: RPC,
        scope: `dealer ${onlyClientId} (scrap on)`,
        days_back: daysBack,
        totalRows: built.rows,
        totalVdpTrue: built.vdp,
      }, 200);
    }

    const groupId = Number(body?.group_id) || 1;
    if (groupId > MAX_QUEUE_WORKERS) {
      return json({ success: true, rpc: RPC, skipped: `group ${groupId} > ${MAX_QUEUE_WORKERS} workers` }, 200);
    }

    const worker = `scrap-${body?.group_id ?? "x"}-${crypto.randomUUID().slice(0, 8)}`;
    console.log(`🧹 Scrap Step 3 queue worker ${worker} (${clientIds.length} dealers, days_back=${daysBack})`);

    const processed: RpcRow[] = [];
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
      const claim = (claimed as RpcRow[] | null)?.[0];
      if (!claim) break;

      const clientId = String(claim.client_id);
      const attempt = Number(claim.attempts) || 1;
      const resumeDay = claim.resume_day ? String(claim.resume_day) : null;
      const dayByDay = attempt > 1 || resumeDay !== null;
      const mode = dayByDay ? "per-day" : "full";
      const label = labelOf(clientId);
      const t0 = Date.now();

      try {
        const retagged = await ensureTagged(supabase, clientId);
        const built = await buildDealer(supabase, clientId, daysBack, dayByDay, deadline, resumeDay);

        if (built.outOfBudget) {
          await supabase.rpc("finish_step3_dealer", {
            p_client_id: clientId,
            p_status: "pending",
            p_total_rows: built.rows,
            p_resume_day: built.nextDay,
          });
          console.log(`⏱️ ${label}: budget reached mid-dealer — resumes from ${built.nextDay} next round`);
          processed.push({ client_id: clientId, status: "released" });
          break;
        }

        await supabase.rpc("finish_step3_dealer", {
          p_client_id: clientId,
          p_status: "done",
          p_total_rows: built.rows,
          p_mode: mode,
        });
        totalRows += built.rows;
        console.log(
          `  ✅ ${label} | ${built.rows} rows | VDP=TRUE ${built.vdp} | ${mode}${retagged ? " +retag" : ""} | ${((Date.now() - t0) / 1000).toFixed(1)}s`,
        );
        processed.push({ client_id: clientId, status: "done", rows: built.rows, mode, attempt });
      } catch (err) {
        const message = formatErr(err);
        await supabase.rpc("finish_step3_dealer", {
          p_client_id: clientId,
          p_status: "error",
          p_error: message.slice(0, 500),
          p_mode: mode,
          p_resume_day: err instanceof DayBuildError ? err.day : null,
        });
        console.error(`    ❌ ${label} attempt ${attempt} (${mode}): ${message}`);
        processed.push({ client_id: clientId, status: "error", error: message, mode, attempt });
      }
    }

    console.log(`📊 Scrap worker ${worker} done — ${processed.length} dealers | ${totalRows} rows | ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
    const ok = processed.every((p) => p.status !== "error");
    return json({
      success: ok,
      rpc: RPC,
      worker,
      days_back: daysBack,
      dealerCount: clientIds.length,
      processed_dealers: processed.length,
      totalRows,
      processed,
    }, ok ? 200 : 207);
  } catch (err) {
    const message = formatErr(err);
    console.error("❌ Scrap Step 3 error:", message);
    return json({ success: false, rpc: RPC, error: message }, 500);
  }
});
