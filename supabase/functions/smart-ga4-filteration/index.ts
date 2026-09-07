import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

/**
 * Step 2 — VDP filtration (smart_ga4_page_data.vdp_conditions).
 * Preserves existing single-dealer / all-dealer behavior.
 * NEW: optional group_id + group_count so cron can finish every dealer
 * without relying on one 145s pass over the full roster.
 */

const GLOBAL_BUDGET_MS = 145_000;
const DEFAULT_GROUP_COUNT = 15;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function pickDealerGroup<T>(
  dealers: T[],
  groupId: number | null,
  groupCount: number,
): T[] {
  if (!groupId || groupCount <= 1) return dealers;
  const g = Math.max(1, Math.min(groupId, groupCount));
  return dealers.filter((_, idx) => idx % groupCount === g - 1);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startTime = Date.now();
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    /* empty body = legacy cron */
  }

  const onlyClientId = body?.client_id ? String(body.client_id).trim() : null;
  const daysBack = body?.days_back != null ? Number(body.days_back) : 7;
  const groupId = body?.group_id != null ? Number(body.group_id) : null;
  const groupCount =
    body?.group_count != null
      ? Math.max(1, Number(body.group_count))
      : DEFAULT_GROUP_COUNT;

  const scope = onlyClientId
    ? `dealer ${onlyClientId}`
    : groupId
      ? `group ${groupId}/${groupCount}`
      : "ALL CMS";

  console.log(
    `🧹 Starting GA4 Data Filtration for ${scope}. Days back: ${daysBack}...`,
  );

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    if (onlyClientId) {
      console.log(`⏳ Calling apply_vdp_filtration('${onlyClientId}')...`);
      const { data, error } = await supabase.rpc("apply_vdp_filtration", {
        p_client_id: onlyClientId,
        p_days_back: daysBack,
      });
      if (error) throw error;
      console.log(`✅ Done. Rows: ${data?.length ?? 0}`);
      return new Response(
        JSON.stringify({ success: true, scope, processed: data }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        },
      );
    }

    console.log(`📋 Fetching active dealers...`);
    const { data: dealers, error: dErr } = await supabase
      .from("smart_ga4_config")
      .select("client_id, account_name")
      .eq("is_active", true)
      .order("account_name", { ascending: true });

    if (dErr) throw dErr;
    if (!dealers?.length) {
      return new Response(
        JSON.stringify({ success: true, message: "No dealers" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        },
      );
    }

    const batch = pickDealerGroup(dealers, groupId, groupCount);
    console.log(
      `Found ${dealers.length} dealers; processing ${batch.length} in this batch...`,
    );

    const results: Record<string, unknown>[] = [];
    let totalRowsUpdated = 0;
    let cutoffReached = false;
    const skipped: string[] = [];

    for (let i = 0; i < batch.length; i++) {
      const dealer = batch[i];
      if (Date.now() - startTime > GLOBAL_BUDGET_MS - 10_000) {
        console.log(`⏱️ Budget reached, stopping before ${dealer.account_name}`);
        cutoffReached = true;
        skipped.push(...batch.slice(i).map((d) => String(d.client_id)));
        break;
      }

      try {
        const { data, error } = await supabase.rpc("apply_vdp_filtration", {
          p_client_id: dealer.client_id,
          p_days_back: daysBack,
        });

        if (error) {
          console.error(`❌ [${dealer.account_name}] ${error.message}`);
          results.push({
            client_id: dealer.client_id,
            account_name: dealer.account_name,
            status: "error",
            error: error.message,
          });
          continue;
        }

        const rowsUpdated = (data || []).reduce(
          (sum: number, r: { count?: number; out_updated_rows?: number }) =>
            sum + (Number(r.out_updated_rows ?? r.count) || 0),
          0,
        );
        totalRowsUpdated += rowsUpdated;
        console.log(`✅ [${dealer.account_name}] ${rowsUpdated} rows`);
        results.push({
          client_id: dealer.client_id,
          account_name: dealer.account_name,
          status: "ok",
          rows: rowsUpdated,
        });
      } catch (ex: unknown) {
        const message = ex instanceof Error ? ex.message : String(ex);
        console.error(`❌ [${dealer.account_name}] ${message}`);
        results.push({
          client_id: dealer.client_id,
          account_name: dealer.account_name,
          status: "error",
          error: message,
        });
      }
    }

    const elapsedMs = Date.now() - startTime;
    console.log(
      `\n📊 Done — ${totalRowsUpdated} rows across ${results.length} dealers in ${elapsedMs}ms`,
    );

    return new Response(
      JSON.stringify({
        success: !cutoffReached && results.every((r) => r.status !== "error"),
        scope,
        days_back: daysBack,
        group_id: groupId,
        group_count: groupCount,
        cutoff_reached: cutoffReached,
        total_dealers: dealers.length,
        batch_dealers: batch.length,
        processed_dealers: results.length,
        skipped_client_ids: skipped,
        totalRowsUpdated,
        elapsed_ms: elapsedMs,
        results,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: cutoffReached ? 207 : 200,
      },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("❌ Filtration error:", message);
    return new Response(
      JSON.stringify({ success: false, scope, error: message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
