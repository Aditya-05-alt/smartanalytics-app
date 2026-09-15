import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

/**
 * Standalone Unknown/Other cleanup — NOT Step 1 / 2 / 3.
 *
 * For each dealer with unmapped final URLs:
 *   1) match smart_vdp_logic_2
 *   2) map hits onto smart_final_data (inv_url / vdp_conditions + make/model/type catalogs)
 *   3) leftover URLs → smart_exception_data
 *
 * Window: 3:00–4:30 PM IST daily · last 7 days.
 */

const GLOBAL_BUDGET_MS = 145_000;
const DEFAULT_GROUP_COUNT = 10;
const DEFAULT_DAYS_BACK = 7;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

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
    /* cron with empty body */
  }

  const onlyClientId = body?.client_id ? String(body.client_id).trim() : null;
  const daysBack = body?.days_back != null
    ? Math.max(1, Number(body.days_back) || DEFAULT_DAYS_BACK)
    : DEFAULT_DAYS_BACK;
  const groupId = body?.group_id != null ? Number(body.group_id) : null;
  const groupCount = body?.group_count != null
    ? Math.max(1, Number(body.group_count))
    : DEFAULT_GROUP_COUNT;

  const to = isoDate(new Date());
  const fromDate = new Date();
  fromDate.setUTCDate(fromDate.getUTCDate() - daysBack);
  const from = isoDate(fromDate);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const scope = onlyClientId
    ? `dealer ${onlyClientId}`
    : groupId
    ? `group ${groupId}/${groupCount}`
    : "all dealers";

  console.log(
    `logic2-unknown-cleanup start · ${scope} · ${from} → ${to}`,
  );

  try {
    if (onlyClientId) {
      const { data, error } = await supabase.rpc("apply_logic2_unknown_cleanup", {
        p_client_id: onlyClientId,
        p_from: from,
        p_to: to,
      });
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, scope, from, to, result: data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    const { data: dealers, error: dErr } = await supabase
      .from("smart_ga4_config")
      .select("client_id, account_name")
      .eq("is_active", true)
      .order("account_name", { ascending: true });
    if (dErr) throw dErr;

    const roster = (dealers || []).filter((d) => d?.client_id);
    const batch = pickDealerGroup(roster, groupId, groupCount);
    const results: Record<string, unknown>[] = [];
    const skipped: string[] = [];
    let cutoffReached = false;
    let mappedRows = 0;
    let exceptionPaths = 0;

    for (let i = 0; i < batch.length; i++) {
      const dealer = batch[i];
      if (Date.now() - startTime > GLOBAL_BUDGET_MS - 12_000) {
        cutoffReached = true;
        skipped.push(...batch.slice(i).map((d) => String(d.client_id)));
        break;
      }

      const { data, error } = await supabase.rpc("apply_logic2_unknown_cleanup", {
        p_client_id: String(dealer.client_id),
        p_from: from,
        p_to: to,
      });

      if (error) {
        console.error(`[${dealer.account_name}] ${error.message}`);
        results.push({
          client_id: dealer.client_id,
          account_name: dealer.account_name,
          status: "error",
          error: error.message,
        });
        continue;
      }

      const row = (data || {}) as Record<string, unknown>;
      mappedRows += Number(row.mapped_rows) || 0;
      exceptionPaths += Number(row.exception_paths) || 0;
      results.push({
        client_id: dealer.client_id,
        account_name: dealer.account_name,
        status: "ok",
        ...row,
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        scope,
        from,
        to,
        dealers_in_batch: batch.length,
        processed: results.length,
        mapped_rows: mappedRows,
        exception_paths: exceptionPaths,
        cutoff_reached: cutoffReached,
        skipped,
        results,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("logic2-unknown-cleanup failed", message);
    return new Response(JSON.stringify({ success: false, error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
