import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Destination Cycle + Jay's Power Center — page_path_q_s Step 3. */
const QS_CLIENT_IDS = ["1421445735", "7543766464"];

const GLOBAL_BUDGET_MS = 140_000;
const MIN_CLAIM_MS = 30_000;
const MAX_ATTEMPTS = 4;
const QUEUE_KIND = "qs";
const RPC = "build_smart_final_data_qs";

type BuildResult = {
  rows: number;
  vdp: number;
  accountName: string | null;
  outOfBudget: boolean;
  /** First day not yet built when outOfBudget. */
  nextDay: string | null;
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

function sumBuildRows(data: unknown) {
  const rows = (data as Record<string, unknown>[] | null) || [];
  return {
    rows: rows.reduce((s, r) => s + (Number(r.out_total_rows) || 0), 0),
    vdp: rows.reduce((s, r) => s + (Number(r.out_vdp_true_rows) || 0), 0),
    accountName: (rows[0]?.account_name as string) ?? null,
  };
}

/** QS builds run one day per call: a 7-day Destination Cycle build exceeds the gateway timeout. */
async function buildDealerPerDay(
  supabase: SupabaseClient,
  clientId: string,
  daysBack: number,
  deadline: number,
  resumeDay: string | null = null,
): Promise<BuildResult> {
  const result: BuildResult = { rows: 0, vdp: 0, accountName: null, outOfBudget: false, nextDay: null };
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
    result.accountName ??= dayTotals.accountName;
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

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * QS Step 3 ONLY — build_smart_final_data_qs for Destination Cycle + Jay's.
 *
 * Cron (no client_id): pulls these dealers from the smart_step3_runs queue so
 * retry rounds only rebuild what is not done tonight.
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
    body?.days_back != null ? Number(body.days_back) : 7;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    if (onlyClientId) {
      const runStep2 = body?.run_step2 !== false;
      console.log(`🧹 QS Step 3 manual for ${onlyClientId} (days_back=${daysBack}, run_step2=${runStep2})`);
      if (runStep2) {
        const { error: filtErr } = await supabase.rpc("apply_vdp_filtration", {
          p_client_id: onlyClientId,
          p_days_back: daysBack,
        });
        if (filtErr) throw new Error(`apply_vdp_filtration: ${filtErr.message}`);
      }
      const built = await buildDealerPerDay(supabase, onlyClientId, daysBack, Number.POSITIVE_INFINITY);
      console.log(`  ✅ ${built.accountName ?? onlyClientId} | ${built.rows} rows | matched ${built.vdp}`);
      return json({
        success: true,
        rpc: RPC,
        days_back: daysBack,
        totalRows: built.rows,
        totalVdpTrue: built.vdp,
      }, 200);
    }

    const worker = `qs-${crypto.randomUUID().slice(0, 8)}`;
    console.log(`🧹 QS Step 3 queue worker ${worker} for ${QS_CLIENT_IDS.join(", ")} (days_back=${daysBack})`);

    const processed: Record<string, unknown>[] = [];
    let totalRows = 0;

    while (deadline - Date.now() > MIN_CLAIM_MS) {
      const { data: claimed, error: claimErr } = await supabase.rpc("claim_step3_dealer", {
        p_kind: QUEUE_KIND,
        p_client_ids: QS_CLIENT_IDS,
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
      const t0 = Date.now();

      try {
        const retagged = await ensureTagged(supabase, clientId);
        const built = await buildDealerPerDay(supabase, clientId, daysBack, deadline, resumeDay);

        if (built.outOfBudget) {
          await supabase.rpc("finish_step3_dealer", {
            p_client_id: clientId,
            p_status: "pending",
            p_total_rows: built.rows,
            p_resume_day: built.nextDay,
          });
          console.log(`⏱️ [${clientId}] budget reached mid-dealer — resumes from ${built.nextDay} next round`);
          processed.push({ client_id: clientId, status: "released" });
          break;
        }

        await supabase.rpc("finish_step3_dealer", {
          p_client_id: clientId,
          p_status: "done",
          p_total_rows: built.rows,
          p_mode: "per-day",
        });
        totalRows += built.rows;
        console.log(
          `  ✅ ${built.accountName ?? clientId} | ${built.rows} rows | matched ${built.vdp}${retagged ? " +retag" : ""} | ${((Date.now() - t0) / 1000).toFixed(1)}s`,
        );
        processed.push({ client_id: clientId, status: "done", rows: built.rows, attempt });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await supabase.rpc("finish_step3_dealer", {
          p_client_id: clientId,
          p_status: "error",
          p_error: message.slice(0, 500),
          p_mode: "per-day",
          p_resume_day: err instanceof DayBuildError ? err.day : null,
        });
        console.error(`❌ [${clientId}] attempt ${attempt}: ${message}`);
        processed.push({ client_id: clientId, status: "error", error: message, attempt });
      }
    }

    const ok = processed.every((p) => p.status !== "error");
    return json({
      success: ok,
      rpc: RPC,
      worker,
      days_back: daysBack,
      totalRows,
      processed,
    }, ok ? 200 : 207);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("❌ QS Step 3 error:", message);
    return json({ success: false, rpc: RPC, error: message }, 500);
  }
});
