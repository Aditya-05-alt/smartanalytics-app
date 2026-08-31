import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GLOBAL_BUDGET_MS = 140_000;

/** Destination Cycle — pathname+query Step 3 (page_path_q_s). All others use fast page_path RPC. */
const PAGE_PATH_QS_CLIENT_IDS = new Set(["1421445735"]);

function hootFinalRpcName(clientId: string): string {
  return PAGE_PATH_QS_CLIENT_IDS.has(String(clientId).trim())
    ? "build_smart_final_data_qs"
    : "build_smart_final_data";
}

/** Hoot Step 3 — build_smart_final_data(_qs) per dealer (avoids all-dealer delete timeout). */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startTime = Date.now();
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    /* no body */
  }

  const onlyClientId: string | null = body?.client_id
    ? String(body.client_id)
    : null;
  const daysBack: number =
    body?.days_back != null ? Number(body.days_back) : 7;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    let clientIds: string[] = [];

    if (onlyClientId) {
      clientIds = [onlyClientId];
    } else {
      const { data: dealers, error: dErr } = await supabase
        .from("smart_ga4_config")
        .select("client_id")
        .eq("is_active", true)
        .order("client_id", { ascending: true });

      if (dErr) throw dErr;
      clientIds = (dealers || []).map((d: { client_id: string }) =>
        String(d.client_id).trim()
      ).filter(Boolean);
    }

    const scope = onlyClientId ? `dealer ${onlyClientId}` : `${clientIds.length} dealers`;
    console.log(
      `🧹 Building smart_final_data (hoot) for ${scope} (days_back=${daysBack}) — per dealer`,
    );

    const results: Record<string, unknown>[] = [];
    let totalRows = 0;
    let totalVdpTrue = 0;
    let cutoffReached = false;

    for (const clientId of clientIds) {
      if (Date.now() - startTime > GLOBAL_BUDGET_MS - 5_000) {
        console.log(`⏱️ Budget reached — stopping before ${clientId}`);
        cutoffReached = true;
        break;
      }

      const rpcName = hootFinalRpcName(clientId);
      const { data, error } = await supabase.rpc(rpcName, {
        p_client_id: clientId,
        p_days_back: daysBack,
        p_date_from: null,
        p_date_to: null,
      });

      if (error) {
        console.error(`❌ [${clientId}] ${rpcName}: ${error.message}`);
        results.push({
          client_id: clientId,
          rpc: rpcName,
          status: "error",
          error: error.message,
        });
        continue;
      }

      const row = (data as Record<string, unknown>[])?.[0];
      const rows = Number(row?.out_total_rows) || 0;
      const vdp = Number(row?.out_vdp_true_rows) || 0;
      totalRows += rows;
      totalVdpTrue += vdp;

      if (rows > 0) {
        console.log(
          `  ✅ ${row?.out_account_name ?? clientId} | ${rpcName} | ${rows} rows | matched ${vdp}`,
        );
      }

      results.push({
        client_id: clientId,
        account_name: row?.out_account_name ?? null,
        rpc: rpcName,
        status: "ok",
        total_rows: rows,
        vdp_true_rows: vdp,
      });
    }

    console.log(
      `\n📊 Done — ${totalRows} rows | matched ${totalVdpTrue} | processed ${results.length}/${clientIds.length}`,
    );

    return new Response(
      JSON.stringify({
        success: true,
        rpc: "build_smart_final_data / build_smart_final_data_qs",
        scope,
        days_back: daysBack,
        cutoff_reached: cutoffReached,
        total_dealers: clientIds.length,
        processed_dealers: results.length,
        totalRows,
        totalVdpTrue,
        processed: results,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("❌ Build error:", message);
    return new Response(
      JSON.stringify({
        success: false,
        rpc: "build_smart_final_data / build_smart_final_data_qs",
        error: message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
