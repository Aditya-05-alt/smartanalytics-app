import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Destination Cycle — page_path_q_s Step 3 (independent of Hoot / Scrap). */
const QS_CLIENT_IDS = ["1421445735"];

/**
 * QS Step 3 ONLY — build_smart_final_data_qs for Destination Cycle.
 * Does not touch other dealers. Independent cron/edge from Hoot and Scrap.
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

  const onlyClientId: string | null = body?.client_id
    ? String(body.client_id).trim()
    : null;
  const daysBack: number =
    body?.days_back != null ? Number(body.days_back) : 7;

  const clientIds = onlyClientId
    ? [onlyClientId]
    : QS_CLIENT_IDS;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    console.log(
      `🧹 QS Step 3 (build_smart_final_data_qs) for ${clientIds.join(", ")} (days_back=${daysBack})`,
    );

    const results: Record<string, unknown>[] = [];
    let totalRows = 0;
    let totalVdpTrue = 0;

    for (const clientId of clientIds) {
      const { data, error } = await supabase.rpc("build_smart_final_data_qs", {
        p_client_id: clientId,
        p_days_back: daysBack,
        p_date_from: null,
        p_date_to: null,
      });

      if (error) {
        console.error(`❌ [${clientId}] build_smart_final_data_qs: ${error.message}`);
        results.push({
          client_id: clientId,
          rpc: "build_smart_final_data_qs",
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

      console.log(
        `  ✅ ${row?.out_account_name ?? row?.account_name ?? clientId} | ${rows} rows | matched ${vdp}`,
      );

      results.push({
        client_id: clientId,
        account_name: row?.out_account_name ?? row?.account_name ?? null,
        rpc: "build_smart_final_data_qs",
        status: "ok",
        total_rows: rows,
        vdp_true_rows: vdp,
      });
    }

    const ok = results.every((r) => r.status !== "error");
    return new Response(
      JSON.stringify({
        success: ok,
        rpc: "build_smart_final_data_qs",
        days_back: daysBack,
        totalRows,
        totalVdpTrue,
        processed: results,
      }),
      {
        status: ok ? 200 : 207,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("❌ QS Step 3 error:", message);
    return new Response(
      JSON.stringify({
        success: false,
        rpc: "build_smart_final_data_qs",
        error: message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
