import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Papa from "npm:papaparse@5";

const CONFIG_TABLE = "smart_hoot_config";
const DATA_TABLE = "smart_hoot_inventory";
const FETCH_CONCURRENCY = 6;
const UPSERT_CHUNK = 500;

// Compared after normalizePlatform, so "Scout RV" / "ScoutRV" / "scoutrv" all match.
const ALLOWED_PLATFORMS = new Set(
  [
    "ScoutRV", "ScoutX", "Dealer Spike", "Interact RV", "CMS Unknown", "DealerOn",
    "Dealer.com", "Ride Digital", "DX1", "Made by Motive", "Power Go",
    "Trader Interactive", "Unknown", "Overfuel", "overfuel.com", "Room 58",
  ].map(normalizePlatform),
);

function normalizePlatform(p: string | null | undefined): string {
  return String(p ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function generateSK(vin: string, url: string) {
  const rawString = `${vin.trim()}_${url.trim()}`;
  const msgUint8 = new TextEncoder().encode(rawString);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

type DealerResult = { dealer: string; status: "ok" | "error"; vehicles?: number; error?: string };

serve(async (_req) => {
  console.log("Starting Hoot Inventory Sync Edge Function...");

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const { data: allConfigs, error: configError } = await supabase
      .from(CONFIG_TABLE)
      .select("*")
      .eq("is_active", true);

    if (configError) throw configError;

    const configs = (allConfigs ?? []).filter(
      (c) => c.hoot_url && ALLOWED_PLATFORMS.has(normalizePlatform(c.website_platform)),
    );
    if (configs.length === 0) {
      return new Response(JSON.stringify({ message: "No active configs found." }), { status: 200 });
    }

    const currentTime = new Date().toISOString();

    // Each dealer is written as soon as it is fetched, so a slow or failing feed
    // can't discard the rows already collected for the others.
    const syncDealer = async (config: any): Promise<DealerResult> => {
      const customerName = config.customer_name || "Unknown";
      const platform = config.website_platform || "Unknown";
      try {
        console.log(`Fetching data for: ${customerName} (${platform})...`);
        const res = await fetch(config.hoot_url);
        if (!res.ok) {
          console.error(`Failed to fetch ${customerName}: HTTP ${res.status}`);
          return { dealer: customerName, status: "error", error: `HTTP ${res.status}` };
        }

        const csvText = await res.text();
        const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });

        const records = new Map<string, Record<string, unknown>>();
        for (const row of parsed.data as any[]) {
          const vin = row["VIN"] || "";
          const url = row["URL"] || "";
          if (!vin || !url) continue;

          const sk = await generateSK(vin, url);
          records.set(sk, {
            sk,
            customer_name: customerName,
            website_platform: platform,
            vin,
            url,
            last_seen: currentTime,
            advertiser: row["Advertiser Name"] || "Unknown",
            make: row["Make"] || "",
            model: row["Model"] || "",
            year: String(row["Year"] || ""),
            price: parseFloat(row["Price"]) || 0,
            condition: row["Condition"] || "",
            location: row["Location"] || "",
            msrp: parseFloat(row["MSRP"] || row["Price alt."] || "0") || 0,
            type_: row["Custom label 1"] || row["custom_label_1"] || "",
            trim: row["Trim"] || "",
            stock_number: row["stock_number"] || row["Stock Number"] || row["Stock"] || row["stock"] || "",
            raw_data: row,
          });
        }

        const rows = Array.from(records.values());
        for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
          const { error } = await supabase
            .from(DATA_TABLE)
            .upsert(rows.slice(i, i + UPSERT_CHUNK), { onConflict: "sk" });
          if (error) throw error;
        }
        console.log(`  ✅ ${customerName} | ${rows.length} vehicles`);
        return { dealer: customerName, status: "ok", vehicles: rows.length };
      } catch (err: any) {
        console.error(`  ❌ ${customerName}: ${err?.message ?? err}`);
        return { dealer: customerName, status: "error", error: String(err?.message ?? err) };
      }
    };

    const results: DealerResult[] = [];
    let next = 0;
    const worker = async () => {
      while (next < configs.length) {
        const config = configs[next++];
        results.push(await syncDealer(config));
      }
    };
    await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, configs.length) }, worker));

    const vehicles = results.reduce((s, r) => s + (r.vehicles ?? 0), 0);
    const failed = results.filter((r) => r.status === "error");
    console.log(`Synced ${vehicles} vehicles across ${results.length - failed.length}/${results.length} dealers.`);

    return new Response(
      JSON.stringify({ success: true, vehicles_synced: vehicles, dealers: results.length, failed }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("Error running Hoot Sync:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});
