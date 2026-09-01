import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GLOBAL_BUDGET_MS = 140_000;
const DEFAULT_GROUP_COUNT = 4;

type RpcRow = Record<string, unknown>;

function pickDealerGroup(
  clientIds: string[],
  groupId: number | null,
  groupCount: number,
): string[] {
  if (!groupId || groupCount <= 1) return clientIds;
  const g = Math.max(1, Math.min(groupId, groupCount));
  return clientIds.filter((_, idx) => idx % groupCount === g - 1);
}

function summarizeRows(data: RpcRow[]) {
  let totalRows = 0;
  let totalVdpTrue = 0;
  const cmsSummary: Record<string, { rows: number; vdp_true: number }> = {};

  for (const row of data) {
    const cms = String(row.cms || row.out_cms || "Unknown");
    const rows = Number(row.out_total_rows) || 0;
    const vdp = Number(row.out_vdp_true_rows) || 0;
    totalRows += rows;
    totalVdpTrue += vdp;
    if (!cmsSummary[cms]) cmsSummary[cms] = { rows: 0, vdp_true: 0 };
    cmsSummary[cms].rows += rows;
    cmsSummary[cms].vdp_true += vdp;
  }

  return { totalRows, totalVdpTrue, cmsSummary };
}

function formatErr(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

async function loadScrapClientIds(
  supabase: ReturnType<typeof createClient>,
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

/**
 * Scrap Step 3 ONLY — build_smart_final_data_scrap for scrap_link=on dealers.
 * Independent of Hoot / QS. Cron should pass group_id 1..4 + group_count 4.
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
    body?.days_back != null ? Number(body.days_back) : 5;
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
    const { clientIds: allIds, dealers } = await loadScrapClientIds(
      supabase,
      onlyClientId,
    );
    const clientIds = pickDealerGroup(allIds, groupId, groupCount);

    const scope = onlyClientId
      ? `dealer ${onlyClientId} (scrap on)`
      : groupId
        ? `group ${groupId}/${groupCount} (${clientIds.length}/${allIds.length} scrap)`
        : `${clientIds.length} scrap dealer(s)`;

    console.log(
      `🧹 Scrap Step 3 (build_smart_final_data_scrap) for ${scope} (days_back=${daysBack})`,
    );

    if (!clientIds.length) {
      return new Response(
        JSON.stringify({
          success: true,
          rpc: "build_smart_final_data_scrap",
          scope,
          dealerCount: 0,
          totalRows: 0,
          totalVdpTrue: 0,
          processed: [],
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const processed: RpcRow[] = [];
    const failures: { clientId: string; customerName: string; error: string }[] =
      [];
    let cutoffReached = false;

    for (const clientId of clientIds) {
      if (Date.now() - startTime > GLOBAL_BUDGET_MS - 5_000) {
        console.log(`⏱️ Budget reached — stopping before ${clientId}`);
        cutoffReached = true;
        break;
      }

      const dealer = dealers.find(
        (d) => String(d.ga4_customer_id).trim() === clientId,
      );
      const label = String(dealer?.customer_name ?? clientId);

      try {
        console.log(`  ▶ ${label} (${clientId})`);
        const { data, error } = await supabase.rpc(
          "build_smart_final_data_scrap",
          {
            p_client_id: clientId,
            p_days_back: daysBack,
            p_date_from: null,
            p_date_to: null,
          },
        );
        if (error) throw new Error(error.message);

        const rows = (data || []) as RpcRow[];
        for (const row of rows) {
          console.log(
            `    👉 ${row.account_name ?? row.out_account_name ?? clientId} | CMS: ${row.cms ?? "—"} | Rows: ${row.out_total_rows ?? 0} | VDP=TRUE: ${row.out_vdp_true_rows ?? 0}`,
          );
        }
        processed.push(...rows);
      } catch (err) {
        const message = formatErr(err);
        console.error(`    ❌ ${label}: ${message}`);
        failures.push({ clientId, customerName: label, error: message });
      }
    }

    const { totalRows, totalVdpTrue, cmsSummary } = summarizeRows(processed);
    const ok = !cutoffReached && failures.length === 0;

    console.log(
      `\n📊 Scrap done: ${clientIds.length - failures.length}/${clientIds.length} | Rows: ${totalRows} | VDP=TRUE: ${totalVdpTrue}`,
    );

    return new Response(
      JSON.stringify({
        success: ok,
        rpc: "build_smart_final_data_scrap",
        scope,
        days_back: daysBack,
        group_id: groupId,
        group_count: groupCount,
        cutoff_reached: cutoffReached,
        dealerCount: allIds.length,
        batch_dealers: clientIds.length,
        dealersSucceeded: clientIds.length - failures.length,
        totalRows,
        totalVdpTrue,
        cmsSummary,
        processed,
        failures,
      }),
      {
        status: ok ? 200 : 207,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    const message = formatErr(err);
    console.error("❌ Scrap Step 3 error:", message);
    return new Response(
      JSON.stringify({
        success: false,
        rpc: "build_smart_final_data_scrap",
        error: message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
