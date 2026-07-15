import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type SnapshotResult = {
  success?: boolean;
  skippedRun?: boolean;
  pullDate?: string;
  message?: string;
  hoot?: {
    inserted?: number;
    skipped?: number;
    sourceRows?: number;
    dailyRows?: number;
  };
  scrap?: {
    inserted?: number;
    skipped?: number;
    sourceRows?: number;
    dailyRows?: number;
  };
};

function parsePullDate(value: unknown): string | null {
  if (value == null || value === "") return null;
  const date = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

/**
 * Daily inventory snapshot — smart_hoot_inventory_live → smart_hoot_inventory_daily.
 * POST /functions/v1/inventory-report-daily-sync
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    /* no body */
  }

  const pullDate = parsePullDate(body?.pull_date);
  const skipIfComplete = body?.skip_if_complete !== false;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { count: liveRowCount, error: liveCountError } = await supabase
      .from("smart_hoot_inventory_live")
      .select("*", { count: "exact", head: true });

    if (liveCountError) {
      throw new Error(
        `${liveCountError.message} — ensure smart_hoot_inventory_live table exists`,
      );
    }

    const liveRows = liveRowCount ?? 0;
    console.log(
      `Inventory daily snapshot pull_date=${pullDate ?? "Asia/Kolkata today"} skip_if_complete=${skipIfComplete} live_rows=${liveRows}`,
    );

    if (liveRows === 0 && !skipIfComplete) {
      throw new Error(
        "smart_hoot_inventory_live is empty — run smart-hoot-inv-live first, then retry snapshot.",
      );
    }

    if (liveRows === 0 && skipIfComplete) {
      const { data: probe, error: probeError } = await supabase.rpc(
        "run_daily_inventory_snapshot",
        { p_pull_date: pullDate, p_skip_if_complete: true },
      );
      if (probeError) throw probeError;
      if ((probe as SnapshotResult)?.skippedRun) {
        return jsonResponse({
          success: true,
          edge: "inventory-report-daily-sync",
          hootSource: "smart_hoot_inventory_live",
          hootLiveRows: 0,
          rpc: "run_daily_inventory_snapshot",
          ...(probe as SnapshotResult),
        });
      }
      throw new Error(
        "smart_hoot_inventory_live is empty — run smart-hoot-inv-live first, then retry snapshot.",
      );
    }

    const { data, error } = await supabase.rpc("run_daily_inventory_snapshot", {
      p_pull_date: pullDate,
      p_skip_if_complete: skipIfComplete,
    });

    if (error) {
      throw new Error(
        `${error.message} — deploy supabase/rpc/snapshot_inventory_daily.sql`,
      );
    }

    const result = (data || {}) as SnapshotResult;

    if (result.skippedRun) {
      console.log(`Skipped: ${result.message ?? "already complete"}`);
    } else {
      console.log(
        `Hoot inserted=${result.hoot?.inserted ?? 0} dailyRows=${result.hoot?.dailyRows ?? 0}`,
      );
      console.log(
        `Scrap inserted=${result.scrap?.inserted ?? 0} dailyRows=${result.scrap?.dailyRows ?? 0}`,
      );
    }

    return jsonResponse({
      success: true,
      edge: "inventory-report-daily-sync",
      hootSource: "smart_hoot_inventory_live",
      hootLiveRows: liveRows,
      rpc: "run_daily_inventory_snapshot",
      ...result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Inventory snapshot error:", message);
    return jsonResponse(
      {
        success: false,
        edge: "inventory-report-daily-sync",
        rpc: "run_daily_inventory_snapshot",
        error: message,
      },
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
