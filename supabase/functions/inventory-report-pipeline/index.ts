import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type EdgeJson = Record<string, unknown>;

function parsePullDate(value: unknown): string | null {
  if (value == null || value === "") return null;
  const date = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function istToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

async function callEdge(
  baseUrl: string,
  serviceKey: string,
  functionName: string,
  body: Record<string, unknown>,
): Promise<EdgeJson> {
  const res = await fetch(`${baseUrl}/functions/v1/${functionName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify(body),
  });

  const json = (await res.json().catch(() => ({}))) as EdgeJson;
  if (!res.ok) {
    const message = String(json.error ?? json.message ?? res.statusText);
    throw new Error(`${functionName}: ${message}`);
  }
  return json;
}

async function isSnapshotComplete(
  supabase: ReturnType<typeof createClient>,
  pullDate: string,
): Promise<boolean> {
  const [{ data: hootLog }, { data: scrapLog }] = await Promise.all([
    supabase
      .from("smart_hoot_inventory_daily_log")
      .select("finished_at, note")
      .eq("pull_date", pullDate)
      .maybeSingle(),
    supabase
      .from("smart_scrap_inventory_daily_log")
      .select("finished_at, note")
      .eq("pull_date", pullDate)
      .maybeSingle(),
  ]);

  const hootDone = Boolean(
    hootLog?.finished_at && hootLog?.note === "ok-insert-only",
  );
  const scrapDone = Boolean(
    scrapLog?.finished_at && scrapLog?.note === "ok-insert-only",
  );

  return hootDone && scrapDone;
}

/**
 * Full inventory report pipeline (9–11 AM IST cron):
 *   1. smart-hoot-inv-live
 *   2. inventory-report-daily-sync
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    /* empty body ok */
  }

  const pullDate = parsePullDate(body?.pull_date) ?? istToday();
  const skipIfComplete = body?.skip_if_complete !== false;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    console.log(
      `inventory-report-pipeline pull_date=${pullDate} skip_if_complete=${skipIfComplete}`,
    );

    if (skipIfComplete && (await isSnapshotComplete(supabase, pullDate))) {
      console.log("Pipeline skipped: snapshot already complete.");
      return jsonResponse({
        success: true,
        edge: "inventory-report-pipeline",
        skippedRun: true,
        pullDate,
        message: "Daily snapshot already complete for pull_date.",
      });
    }

    console.log("Step 1/2 — smart-hoot-inv-live");
    const hoot = await callEdge(
      supabaseUrl,
      serviceKey,
      "smart-hoot-inv-live",
      {},
    );

    console.log("Step 2/2 — inventory-report-daily-sync");
    const snapshot = await callEdge(
      supabaseUrl,
      serviceKey,
      "inventory-report-daily-sync",
      {
        pull_date: pullDate,
        skip_if_complete: false,
      },
    );

    return jsonResponse({
      success: true,
      edge: "inventory-report-pipeline",
      skippedRun: false,
      pullDate,
      hoot,
      snapshot,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("inventory-report-pipeline error:", message);
    return jsonResponse(
      { success: false, edge: "inventory-report-pipeline", error: message },
      500,
    );
  }
});

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
