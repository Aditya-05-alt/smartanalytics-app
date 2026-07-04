import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type RpcRow = Record<string, unknown>;

function summarizeRows(data: RpcRow[]) {
  let totalRows = 0;
  let totalVdpTrue = 0;
  const cmsSummary: Record<string, { rows: number; vdp_true: number }> = {};

  for (const row of data) {
    const cms = String(row.out_cms || row.cms || "Unknown");
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

/** Dealers with scrap_link = on in smart_vdp_logic (via get_scrap_dealers_for_sync). */
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

async function buildScrapForClient(
  supabase: ReturnType<typeof createClient>,
  clientId: string,
  daysBack: number,
) {
  const { data, error } = await supabase.rpc("build_smart_final_data_scrap", {
    p_client_id: clientId,
    p_days_back: daysBack,
    p_date_from: null,
    p_date_to: null,
  });

  if (error) throw error;
  return (data || []) as RpcRow[];
}

/**
 * Scrap Step 3 — runs build_smart_final_data_scrap only for VDP Logics dealers
 * where scrap_link = 'on' (get_scrap_dealers_for_sync). Optional body.client_id
 * limits to one scrap dealer.
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
    body?.days_back != null ? Number(body.days_back) : 5;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { clientIds, dealers } = await loadScrapClientIds(
      supabase,
      onlyClientId,
    );

    const scope = onlyClientId
      ? `dealer ${onlyClientId} (scrap on)`
      : `${clientIds.length} scrap dealer(s)`;

    console.log(
      `🧹 Building smart_final_data (scrap) for ${scope} (days_back=${daysBack})`,
    );

    if (!clientIds.length) {
      console.log("ℹ️ No scrap dealers (scrap_link = on in VDP Logics).");
      return new Response(
        JSON.stringify({
          success: true,
          rpc: "build_smart_final_data_scrap",
          scope,
          dealerCount: 0,
          totalRows: 0,
          totalVdpTrue: 0,
          cmsSummary: {},
          processed: [],
          dealers: [],
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

    for (const clientId of clientIds) {
      const dealer = dealers.find(
        (d) => String(d.ga4_customer_id).trim() === clientId,
      );
      const label = String(
        dealer?.customer_name ?? clientId,
      );

      try {
        console.log(`  ▶ ${label} (${clientId})`);
        const rows = await buildScrapForClient(supabase, clientId, daysBack);
        for (const row of rows) {
          console.log(
            `    👉 ${row.out_account_name ?? row.client_id ?? clientId} | CMS: ${row.out_cms ?? "—"} | Rows: ${row.out_total_rows ?? 0} | VDP=TRUE: ${row.out_vdp_true_rows ?? 0}`,
          );
        }
        processed.push(...rows);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`    ❌ ${label}: ${message}`);
        failures.push({ clientId, customerName: label, error: message });
      }
    }

    const { totalRows, totalVdpTrue, cmsSummary } = summarizeRows(processed);

    console.log(
      `\n📊 Scrap build done: ${clientIds.length - failures.length}/${clientIds.length} dealers | Total Rows: ${totalRows} | VDP=TRUE: ${totalVdpTrue}`,
    );

    return new Response(
      JSON.stringify({
        success: failures.length === 0,
        rpc: "build_smart_final_data_scrap",
        scope,
        dealerCount: clientIds.length,
        dealersSucceeded: clientIds.length - failures.length,
        totalRows,
        totalVdpTrue,
        cmsSummary,
        processed,
        failures,
      }),
      {
        status: failures.length ? 207 : 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("❌ Build error (scrap):", message);
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
