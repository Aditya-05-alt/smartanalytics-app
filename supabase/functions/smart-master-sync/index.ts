import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Hoot Step 3 — calls build_smart_final_data (smart_hoot_inventory only). */
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
    ? String(body.client_id)
    : null;
  const daysBack: number | null =
    body?.days_back != null ? Number(body.days_back) : null;

  const scope = onlyClientId ? `dealer ${onlyClientId}` : "ALL DEALERS";
  console.log(
    `🧹 Building smart_final_data (hoot) for ${scope} (days_back=${daysBack ?? "ALL"})`,
  );

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { data, error } = await supabase.rpc("build_smart_final_data", {
      p_client_id: onlyClientId,
      p_days_back: daysBack,
      p_date_from: null,
      p_date_to: null,
    });

    if (error) throw error;

    let totalRows = 0;
    let totalVdpTrue = 0;
    const cmsSummary: Record<string, { rows: number; vdp_true: number }> = {};

    if (data && data.length > 0) {
      console.log("✅ Build complete (hoot):");
      for (const row of data as Record<string, unknown>[]) {
        const cms = String(row.out_cms || "Unknown");
        const rows = Number(row.out_total_rows) || 0;
        const vdp = Number(row.out_vdp_true_rows) || 0;
        console.log(
          `  👉 ${row.out_account_name ?? row.out_client_id} | CMS: ${cms} | Rows: ${rows} | VDP=TRUE: ${vdp}`,
        );
        totalRows += rows;
        totalVdpTrue += vdp;
        if (!cmsSummary[cms]) cmsSummary[cms] = { rows: 0, vdp_true: 0 };
        cmsSummary[cms].rows += rows;
        cmsSummary[cms].vdp_true += vdp;
      }
      console.log(`\n📊 Total Rows: ${totalRows} | VDP=TRUE: ${totalVdpTrue}`);
    } else {
      console.log(`ℹ️ No rows produced for ${scope}.`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        rpc: "build_smart_final_data",
        scope,
        totalRows,
        totalVdpTrue,
        cmsSummary,
        processed: data ?? [],
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
        rpc: "build_smart_final_data",
        scope,
        error: message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
