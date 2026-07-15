import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import Papa from "https://esm.sh/papaparse@5.4.1";

const CONFIG_TABLE = "smart_hoot_config";
const BATCH_SIZE = 500;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type HootRow = {
  sk: string;
  customer_name: string;
  ga4_customer_id: string | null;
  website_platform: string;
  vin: string;
  url: string;
  advertiser: string;
  make: string;
  model: string;
  year: string;
  price: number;
  condition: string;
  location: string;
  msrp: number;
  type_: string;
  trim: string;
  stock_number: string;
  raw_data: Record<string, unknown>;
  synced_at: string;
};

async function generateSK(vin: string, url: string): Promise<string> {
  const rawString = `${vin.trim()}_${url.trim()}`;
  const msgUint8 = new TextEncoder().encode(rawString);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function parsePrice(value: unknown): number {
  const n = parseFloat(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Full-replace Hoot inventory sync → smart_hoot_inventory_live.
 * 1. Fetch all active dealers with hoot_url
 * 2. Parse CSV from each link
 * 3. TRUNCATE live table
 * 4. Insert all rows in batches (no first_seen / last_seen)
 *
 * Body (optional): { "platforms_only": false } — when true, only known CMS platforms
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

  const platformsOnly = body?.platforms_only === true;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const syncedAt = new Date().toISOString();
  let logId: number | null = null;

  try {
    console.log("🚗 Starting Hoot live inventory sync...");

    const { data: logRow, error: logError } = await supabase
      .from("smart_hoot_inventory_live_log")
      .insert({ started_at: syncedAt, note: "running" })
      .select("id")
      .single();

    if (logError) {
      console.warn("Log insert warning:", logError.message);
    } else {
      logId = logRow?.id ?? null;
    }

    let configQuery = supabase
      .from(CONFIG_TABLE)
      .select(
        "customer_name, ga4_customer_id, hoot_url, website_platform, is_active",
      )
      .eq("is_active", true)
      .not("hoot_url", "is", null);

    if (platformsOnly) {
      configQuery = configQuery.in("website_platform", [
        "ScoutRV",
        "Dealer Spike",
        "DealerSpike",
        "Interact RV",
        "InteractRV",
        "CMS Unknown",
        "DealerOn",
        "Dealer.com",
        "RideDigital",
        "Ride Digital",
        "DX1",
        "ScoutX",
        "Scout X",
        "Dealerspike",
        "Made by motive",
        "Power Go",
        "Trader Interactive",
        "Unknown",
        "overfuel.com",
        "Made By Motive",
        "made By motive",
      ]);
    }

    const { data: configs, error: configError } = await configQuery;

    if (configError) throw configError;
    if (!configs?.length) {
      return jsonResponse({
        success: true,
        message: "No active dealers with hoot_url found.",
        vehicles_synced: 0,
      });
    }

    const uniqueRecordsMap = new Map<string, HootRow>();
    let dealersOk = 0;

    for (const config of configs) {
      const customerName = String(config.customer_name ?? "Unknown").trim();
      const link = String(config.hoot_url ?? "").trim();
      const platform = String(config.website_platform ?? "Unknown").trim();
      const ga4Id = config.ga4_customer_id
        ? String(config.ga4_customer_id).trim()
        : null;

      if (!link) continue;

      console.log(`Fetching: ${customerName} (${platform})`);

      try {
        const res = await fetch(link, {
          headers: { "User-Agent": "SmartAnalytics-HootSync/1.0" },
        });
        if (!res.ok) {
          console.error(`HTTP ${res.status} for ${customerName}`);
          continue;
        }

        const csvText = await res.text();
        const parsed = Papa.parse<Record<string, string>>(csvText, {
          header: true,
          skipEmptyLines: true,
        });

        if (parsed.errors?.length) {
          console.warn(`CSV warnings for ${customerName}:`, parsed.errors[0]);
        }

        for (const row of parsed.data) {
          const vin = String(row["VIN"] ?? "").trim();
          const url = String(row["URL"] ?? "").trim();
          if (!vin || !url) continue;

          const sk = await generateSK(vin, url);

          uniqueRecordsMap.set(sk, {
            sk,
            customer_name: customerName,
            ga4_customer_id: ga4Id,
            website_platform: platform,
            vin,
            url,
            advertiser: String(row["Advertiser Name"] ?? "Unknown").trim(),
            make: String(row["Make"] ?? "").trim(),
            model: String(row["Model"] ?? "").trim(),
            year: String(row["Year"] ?? "").trim(),
            price: parsePrice(row["Price"]),
            condition: String(row["Condition"] ?? "").trim(),
            location: String(row["Location"] ?? "").trim(),
            msrp: parsePrice(row["MSRP"] ?? row["Price alt."]),
            type_: String(
              row["Custom label 1"] ?? row["custom_label_1"] ?? "",
            ).trim(),
            trim: String(row["Trim"] ?? "").trim(),
            stock_number: String(
              row["stock_number"] ??
                row["Stock Number"] ??
                row["Stock"] ??
                row["stock"] ??
                "",
            ).trim(),
            raw_data: row,
            synced_at: syncedAt,
          });
        }

        dealersOk += 1;
      } catch (err) {
        console.error(`Failed ${customerName}:`, err);
      }
    }

    const allRecords = Array.from(uniqueRecordsMap.values());
    console.log(
      `Extracted ${allRecords.length} unique vehicles from ${dealersOk}/${configs.length} dealers.`,
    );

    const { error: truncateError } = await supabase.rpc(
      "truncate_smart_hoot_inventory_live",
    );
    if (truncateError) {
      throw new Error(
        `${truncateError.message} — deploy supabase/migrations/smart_hoot_inventory_live.sql`,
      );
    }

    let insertedTotal = 0;
    for (let i = 0; i < allRecords.length; i += BATCH_SIZE) {
      const chunk = allRecords.slice(i, i + BATCH_SIZE);
      const { data: batchCount, error: insertError } = await supabase.rpc(
        "insert_smart_hoot_inventory_live_batch",
        { p_rows: chunk },
      );
      if (insertError) throw insertError;
      insertedTotal += Number(batchCount ?? 0);
    }

    if (logId != null) {
      await supabase.rpc("finish_smart_hoot_inventory_live_log", {
        p_log_id: logId,
        p_dealers_total: configs.length,
        p_dealers_ok: dealersOk,
        p_row_count: insertedTotal,
        p_note: "ok",
      });
    }

    console.log(`✅ Sync complete: ${insertedTotal} rows in smart_hoot_inventory_live`);

    return jsonResponse({
      success: true,
      rpc: "hoot-inventory-live-sync",
      dealers_total: configs.length,
      dealers_ok: dealersOk,
      vehicles_unique: allRecords.length,
      vehicles_synced: insertedTotal,
      synced_at: syncedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("❌ Hoot live sync error:", message);

    if (logId != null) {
      await supabase.rpc("finish_smart_hoot_inventory_live_log", {
        p_log_id: logId,
        p_dealers_total: 0,
        p_dealers_ok: 0,
        p_row_count: 0,
        p_note: `error: ${message}`,
      });
    }

    return jsonResponse({ success: false, error: message }, 500);
  }
});

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
