import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GLOBAL_BUDGET_MS = 140_000;
const DEFAULT_GROUP_COUNT = 10;

/** Destination Cycle — handled only by smart-master-sync-qs. */
const PAGE_PATH_QS_CLIENT_IDS = new Set(["1421445735"]);

function pickDealerGroup(
  clientIds: string[],
  groupId: number | null,
  groupCount: number,
): string[] {
  if (!groupId || groupCount <= 1) return clientIds;
  const g = Math.max(1, Math.min(groupId, groupCount));
  return clientIds.filter((_, idx) => idx % groupCount === g - 1);
}

/**
 * Hoot Step 3 ONLY — build_smart_final_data per dealer.
 * Skips Destination Cycle (QS) and scrap_link=on dealers (handled by separate fns).
 * Pass group_id + group_count from cron so all ~88 dealers finish under 140s budget.
 */
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
    ? String(body.client_id).trim()
    : null;
  const daysBack: number =
    body?.days_back != null ? Number(body.days_back) : 7;
  const groupId: number | null =
    body?.group_id != null ? Number(body.group_id) : null;
  const groupCount: number =
    body?.group_count != null
      ? Math.max(1, Number(body.group_count))
      : DEFAULT_GROUP_COUNT;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    let clientIds: string[] = [];
    let scrapSkip = new Set<string>();

    if (onlyClientId) {
      clientIds = [onlyClientId];
    } else {
      const [{ data: dealers, error: dErr }, { data: scrapDealers }] =
        await Promise.all([
          supabase
            .from("smart_ga4_config")
            .select("client_id")
            .eq("is_active", true)
            .order("client_id", { ascending: true }),
          supabase.rpc("get_scrap_dealers_for_sync", { p_client_id: null }),
        ]);

      if (dErr) throw dErr;

      scrapSkip = new Set(
        ((scrapDealers as { ga4_customer_id?: string }[]) || [])
          .map((d) => String(d.ga4_customer_id ?? "").trim())
          .filter(Boolean),
      );

      clientIds = (dealers || [])
        .map((d: { client_id: string }) => String(d.client_id).trim())
        .filter(Boolean)
        .filter((id) => !PAGE_PATH_QS_CLIENT_IDS.has(id))
        .filter((id) => !scrapSkip.has(id));
    }

    const batchIds = pickDealerGroup(clientIds, groupId, groupCount);
    const scope = onlyClientId
      ? `dealer ${onlyClientId}`
      : groupId
        ? `group ${groupId}/${groupCount} (${batchIds.length}/${clientIds.length} hoot dealers)`
        : `${clientIds.length} hoot dealers`;

    console.log(
      `🧹 Hoot Step 3 (build_smart_final_data) for ${scope} (days_back=${daysBack})`,
    );

    const results: Record<string, unknown>[] = [];
    let totalRows = 0;
    let totalVdpTrue = 0;
    let cutoffReached = false;

    for (const clientId of batchIds) {
      if (Date.now() - startTime > GLOBAL_BUDGET_MS - 5_000) {
        console.log(`⏱️ Budget reached — stopping before ${clientId}`);
        cutoffReached = true;
        break;
      }

      const { data, error } = await supabase.rpc("build_smart_final_data", {
        p_client_id: clientId,
        p_days_back: daysBack,
        p_date_from: null,
        p_date_to: null,
      });

      if (error) {
        console.error(`❌ [${clientId}] build_smart_final_data: ${error.message}`);
        results.push({
          client_id: clientId,
          rpc: "build_smart_final_data",
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
          `  ✅ ${row?.out_account_name ?? row?.account_name ?? clientId} | ${rows} rows | matched ${vdp}`,
        );
      }

      results.push({
        client_id: clientId,
        account_name: row?.out_account_name ?? row?.account_name ?? null,
        rpc: "build_smart_final_data",
        status: "ok",
        total_rows: rows,
        vdp_true_rows: vdp,
      });
    }

    console.log(
      `\n📊 Hoot done — ${totalRows} rows | matched ${totalVdpTrue} | ${results.length}/${batchIds.length}`,
    );

    return new Response(
      JSON.stringify({
        success: !cutoffReached && results.every((r) => r.status !== "error"),
        rpc: "build_smart_final_data",
        scope,
        days_back: daysBack,
        group_id: groupId,
        group_count: groupCount,
        cutoff_reached: cutoffReached,
        total_dealers: clientIds.length,
        batch_dealers: batchIds.length,
        processed_dealers: results.length,
        skipped_qs: [...PAGE_PATH_QS_CLIENT_IDS],
        skipped_scrap_count: scrapSkip.size,
        totalRows,
        totalVdpTrue,
        processed: results,
      }),
      {
        status: cutoffReached || results.some((r) => r.status === "error")
          ? 207
          : 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("❌ Hoot Step 3 error:", message);
    return new Response(
      JSON.stringify({
        success: false,
        rpc: "build_smart_final_data",
        error: message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
