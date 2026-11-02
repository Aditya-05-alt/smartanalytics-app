import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.3";
import { JWT } from "npm:google-auth-library@9.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const USERS_TABLE = "smart_events_users";
const CONFIG_TABLE = "smart_ga4_config";
const ALL_CHANNELS = "(all)";

/** Event Tracking dealers: Sky River RV, Gerzeny's RV, A&L RV Sales. */
const EVENT_TRACKING_CLIENT_IDS = ["9842851162", "1162028739", "2728830488"];

const isIsoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + "T00:00:00Z"));

/** Previous calendar month in UTC, e.g. run on 2026-11-02 -> 2026-10-01..2026-10-31. */
function previousMonth() {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const L: string[] = [];
  const log = (m: string) => {
    L.push(m);
    console.log(m);
  };
  const jsonRes = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), {
      status: s,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const SB_URL = Deno.env.get("SUPABASE_URL") || "";
    const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!SB_URL || !SB_KEY) throw new Error("Missing SUPABASE config");
    const supabase = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      /* empty body ok */
    }

    const defaults = previousMonth();
    const dateFrom = String(body.date_from ?? body.start_date ?? defaults.from);
    const dateTo = String(body.date_to ?? body.end_date ?? defaults.to);
    if (!isIsoDate(dateFrom) || !isIsoDate(dateTo) || dateFrom > dateTo) {
      return jsonRes({ error: `Invalid date range: ${dateFrom} → ${dateTo}` }, 400);
    }

    const requested = Array.isArray(body.client_ids)
      ? (body.client_ids as unknown[]).map(String)
      : body.client_id || body.target_client_id
        ? [String(body.client_id ?? body.target_client_id)]
        : EVENT_TRACKING_CLIENT_IDS;
    const clientIds = requested.filter((id) => EVENT_TRACKING_CLIENT_IDS.includes(id));
    if (!clientIds.length) {
      return jsonRes({ error: "No Event Tracking dealers requested" }, 400);
    }

    log(`=== GA4 TOTAL USERS — ${dateFrom} → ${dateTo} — ${clientIds.length} dealer(s) ===`);

    const { data: dealers, error: dErr } = await supabase
      .from(CONFIG_TABLE)
      .select("client_id, ga4_property_id, account_name")
      .eq("is_active", true)
      .in("client_id", clientIds);
    if (dErr) return jsonRes({ error: `Config fetch failed: ${dErr.message}`, log: L }, 500);
    if (!dealers?.length) return jsonRes({ error: "No active configs found", log: L }, 400);

    const saEnv = Deno.env.get("GCP_SERVICE_ACCOUNT_JSON");
    if (!saEnv) throw new Error("Missing GCP_SERVICE_ACCOUNT_JSON");
    const credentials = JSON.parse(saEnv);
    const authClient = new JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
    });
    const { token: TOKEN } = await authClient.getAccessToken();
    if (!TOKEN) throw new Error("Failed to get GA4 access token");
    log("Token OK");

    type GaRow = { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] };
    const runReport = async (propertyId: string, dimensions: { name: string }[]) => {
      const res = await fetch(
        `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
        {
          method: "POST",
          headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" },
          body: JSON.stringify({
            dateRanges: [{ startDate: dateFrom, endDate: dateTo }],
            dimensions,
            metrics: [{ name: "totalUsers" }],
            limit: 100,
          }),
        }
      );
      if (!res.ok) throw new Error(`GA4 API ${res.status}: ${await res.text()}`);
      return ((await res.json()).rows || []) as GaRow[];
    };

    const summary: Record<string, unknown>[] = [];
    for (const dealer of dealers) {
      const clientId = dealer.client_id as string;
      const propertyId = String(dealer.ga4_property_id).replace("properties/", "").trim();
      const accountName = (dealer.account_name as string) || clientId;
      try {
        const [overallRows, channelRows] = await Promise.all([
          runReport(propertyId, []),
          runReport(propertyId, [{ name: "sessionDefaultChannelGroup" }]),
        ]);

        const base = {
          client_id: clientId,
          ga4_property_id: propertyId,
          account_name: accountName,
          period_from: dateFrom,
          period_to: dateTo,
        };
        const overall = parseInt(overallRows[0]?.metricValues?.[0]?.value || "0") || 0;
        const rows = [
          { ...base, channel: ALL_CHANNELS, total_users: overall },
          ...channelRows.map((row) => ({
            ...base,
            channel: row.dimensionValues?.[0]?.value || "Unassigned",
            total_users: parseInt(row.metricValues?.[0]?.value || "0") || 0,
          })),
        ];

        // Replace the period only after GA4 returned successfully.
        const { error: delErr } = await supabase
          .from(USERS_TABLE)
          .delete()
          .eq("client_id", clientId)
          .eq("period_from", dateFrom)
          .eq("period_to", dateTo);
        if (delErr) throw new Error(`delete failed: ${delErr.message}`);
        const { error: insErr } = await supabase.from(USERS_TABLE).insert(rows);
        if (insErr) throw new Error(`insert failed: ${insErr.message}`);

        log(`  ✅ ${accountName}: total_users=${overall}, channels=${channelRows.length}`);
        summary.push({ client_id: clientId, account_name: accountName, total_users: overall, channels: channelRows.length });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        log(`  ❌ ${accountName}: ${msg}`);
        summary.push({ client_id: clientId, account_name: accountName, error: msg });
      }
    }

    const failed = summary.filter((s) => s.error).length;
    return jsonRes({ success: failed === 0, window: { from: dateFrom, to: dateTo }, dealers: summary, log: L }, failed ? 207 : 200);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonRes({ error: message, log: L }, 500);
  }
});
