import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { crypto as stdCrypto } from "https://deno.land/std@0.168.0/crypto/mod.ts";
import { encode as hexEncode } from "https://deno.land/std@0.168.0/encoding/hex.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GLOBAL_BUDGET_MS = 140_000;
const FETCH_TIMEOUT_MS = 60_000;
const INSERT_BATCH = 500;
const CONCURRENCY = 4;

type ConnerDealer = {
  conner_config_id: number;
  customer_name: string;
  ga4_customer_id: string;
  website_platform: string | null;
  feed_url: string;
};

type DealerResult = {
  client_id: string;
  customer_name: string;
  status: "loaded" | "skipped" | "error";
  rows?: number;
  reason?: string;
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** update_date in the Conner tables defaults to the IST calendar day. */
function istDay(): string {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}

/** RFC 4180 CSV: quoted fields, doubled quotes, CR/LF and newlines inside quotes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const s = text.replace(/^\uFEFF/, "");

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function numeric(value: string | undefined): number | null {
  const n = String(value ?? "").replace(/[^0-9.]/g, "");
  return n === "" ? null : Number(n);
}

function nonEmpty(value: string | undefined): string | null {
  const v = String(value ?? "").trim();
  return v === "" ? null : v;
}

function initcap(value: string | null): string | null {
  if (!value) return null;
  return value.toLowerCase().replace(/(^|[^a-z])([a-z])/g, (_, p, c) => p + c.toUpperCase());
}

async function md5Hex(value: string): Promise<string> {
  const digest = await stdCrypto.subtle.digest("MD5", new TextEncoder().encode(value));
  return new TextDecoder().decode(hexEncode(new Uint8Array(digest)));
}

async function fetchFeed(url: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** Feeds that leave custom_label_0 blank fall back to the dealer's last known location. */
async function lastKnownLocation(supabase: SupabaseClient, customerName: string): Promise<string | null> {
  const { data } = await supabase
    .from("smart_conner_inventory")
    .select("location")
    .eq("customer_name", customerName)
    .not("location", "is", null)
    .order("update_date", { ascending: false })
    .limit(1);
  return (data as { location: string | null }[] | null)?.[0]?.location ?? null;
}

async function insertBatches(supabase: SupabaseClient, table: string, rows: Record<string, unknown>[]) {
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const { error } = await supabase.from(table).insert(rows.slice(i, i + INSERT_BATCH));
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

async function loadDealer(
  supabase: SupabaseClient,
  dealer: ConnerDealer,
  today: string,
  force: boolean,
): Promise<DealerResult> {
  const base = { client_id: dealer.ga4_customer_id, customer_name: dealer.customer_name };

  if (!force) {
    const { count, error } = await supabase
      .from("smart_conner_inventory")
      .select("id", { count: "exact", head: true })
      .eq("customer_name", dealer.customer_name)
      .eq("update_date", today);
    if (error) throw new Error(error.message);
    if ((count ?? 0) > 0) return { ...base, status: "skipped", reason: `already loaded for ${today}` };
  }

  const csv = parseCsv(await fetchFeed(dealer.feed_url));
  if (csv.length < 2) return { ...base, status: "error", reason: "feed has no data rows" };

  const header = csv[0].map((h) => h.trim());
  const fallbackLocation = await lastKnownLocation(supabase, dealer.customer_name);
  const platform = dealer.website_platform ?? null;

  const inv: Record<string, unknown>[] = [];
  const live: Record<string, unknown>[] = [];
  const nowIso = new Date().toISOString();

  for (const cells of csv.slice(1)) {
    if (cells.length !== header.length) continue;
    const rec: Record<string, string> = {};
    header.forEach((h, idx) => (rec[h] = cells[idx]));
    if (!nonEmpty(rec.id)) continue;

    const vin = nonEmpty(rec.vin);
    const url = nonEmpty(rec.link);
    const common = {
      sk: await md5Hex(`${rec.vin ?? ""}|${rec.link ?? ""}`),
      vin,
      url,
      advertiser: dealer.customer_name,
      make: nonEmpty(String(rec.brand ?? "").replace(/[®™]/g, "")),
      model: nonEmpty(rec.model),
      year: nonEmpty(rec.year),
      price: numeric(rec.price),
      condition: initcap(nonEmpty(rec.condition)),
      raw_data: rec,
      customer_name: dealer.customer_name,
      location: nonEmpty(rec.custom_label_0) ?? fallbackLocation,
      msrp: numeric(rec.vehicle_msrp),
      type_: nonEmpty(rec.custom_label_1),
      trim: nonEmpty(rec.trim),
      stock_number: nonEmpty(rec.id),
      website_platform: platform,
    };
    inv.push({ ...common, first_seen: nowIso, last_seen: nowIso });
    live.push({ ...common, ga4_customer_id: dealer.ga4_customer_id });
  }

  if (!inv.length) return { ...base, status: "error", reason: "no valid rows parsed" };

  await insertBatches(supabase, "smart_conner_inventory", inv);
  await insertBatches(supabase, "smart_conner_inventory_live", live);
  return { ...base, status: "loaded", rows: inv.length };
}

/**
 * Daily Conner inventory load: downloads each active Conner feed (smart_conner_config.hoot_url)
 * and appends that day's snapshot to smart_conner_inventory + smart_conner_inventory_live.
 *
 * Body (optional): client_id / client_ids to limit dealers; force:true to load again
 * even when today's rows already exist.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startTime = Date.now();
  const deadline = startTime + GLOBAL_BUDGET_MS - 15_000;
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    /* no body */
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { data, error } = await supabase.rpc("get_conner_dealers_for_sync", { p_client_id: null });
    if (error) throw new Error(`get_conner_dealers_for_sync: ${error.message}`);

    let dealers = (data as ConnerDealer[] | null) || [];
    const only = body?.client_id
      ? [String(body.client_id).trim()]
      : Array.isArray(body?.client_ids)
        ? (body.client_ids as unknown[]).map((v) => String(v).trim())
        : null;
    if (only) dealers = dealers.filter((d) => only.includes(String(d.ga4_customer_id).trim()));

    const force = body?.force === true;
    const today = istDay();
    console.log(`📦 Conner inventory sync ${today}: ${dealers.length} dealer(s)${force ? " (force)" : ""}`);

    const results: DealerResult[] = [];
    const remaining: string[] = [];
    let cursor = 0;

    const workers = Array.from({ length: CONCURRENCY }, async () => {
      while (cursor < dealers.length) {
        const dealer = dealers[cursor++];
        if (Date.now() > deadline) {
          remaining.push(dealer.ga4_customer_id);
          continue;
        }
        try {
          const r = await loadDealer(supabase, dealer, today, force);
          console.log(`  ${r.status === "loaded" ? "✅" : r.status === "skipped" ? "⏭️" : "❌"} ${dealer.customer_name} | ${r.rows ?? 0} rows${r.reason ? ` | ${r.reason}` : ""}`);
          results.push(r);
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          console.error(`  ❌ ${dealer.customer_name}: ${reason}`);
          results.push({
            client_id: dealer.ga4_customer_id,
            customer_name: dealer.customer_name,
            status: "error",
            reason,
          });
        }
      }
    });
    await Promise.all(workers);

    const ok = results.every((r) => r.status !== "error") && remaining.length === 0;
    return json({
      success: ok,
      update_date: today,
      loaded: results.filter((r) => r.status === "loaded").length,
      skipped: results.filter((r) => r.status === "skipped").length,
      errors: results.filter((r) => r.status === "error").length,
      rows: results.reduce((s, r) => s + (r.rows ?? 0), 0),
      results,
      remaining,
      seconds: Math.round((Date.now() - startTime) / 1000),
    }, ok ? 200 : 207);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("❌ Conner inventory sync error:", message);
    return json({ success: false, error: message }, 500);
  }
});
