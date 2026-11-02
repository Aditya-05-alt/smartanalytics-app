import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.3";
import { JWT } from "npm:google-auth-library@9.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const EVENTS_TABLE = "smart_events_data";
const CONFIG_TABLE = "smart_ga4_config";
const CHUNK_SIZE = 500;
const GLOBAL_BUDGET_MS = 130_000;
const PAGE_SIZE = 10_000;

/** Event Tracking is Sky River RV only for now. */
const SKY_RIVER_CLIENT_ID = "9842851162";

const FORM_EVENTS = [
  "contact_us_submit",
  "check_availability_submit",
  "trade_value_submit",
  "financing_submit",
  "other_form_submit",
  "custom_form_submit",
  "parts_submit",
  "service_submit",
];

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const todayUTC = () => new Date().toISOString().split("T")[0];

const normalizeDate = (v: unknown, fallback: string): string => {
  const s = (v ?? "").toString().trim().toLowerCase();
  if (!s) return fallback;
  if (s === "today") return todayUTC();
  return s;
};

function pathFromLocation(loc: string) {
  try {
    return new URL(loc).pathname;
  } catch {
    return loc;
  }
}

serve(async (req) => {
  const startTime = Date.now();
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
    const supabase = createClient(SB_URL, SB_KEY, {
      auth: { persistSession: false },
    });

    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      /* empty body ok */
    }

    const clientId = String(
      body.target_client_id ?? body.client_id ?? SKY_RIVER_CLIENT_ID
    );
    if (clientId !== SKY_RIVER_CLIENT_ID) {
      return jsonRes(
        { error: `smart-ga4-events is limited to Sky River RV (${SKY_RIVER_CLIENT_ID})` },
        400
      );
    }
    const dateFrom = normalizeDate(body.date_from ?? body.start_date, "2026-10-01");
    const dateTo = normalizeDate(body.date_to ?? body.end_date, todayUTC());
    const listEvents = body.list_events === true;
    const skipExisting = body.skip_existing === true;
    const eventNames = Array.isArray(body.event_names) && body.event_names.length
      ? (body.event_names as string[]).map(String)
      : FORM_EVENTS;

    log(`=== GA4 EVENTS SYNC — Sky River RV ${listEvents ? "(LIST EVENTS, no write)" : ""} ===`);
    log(`Window: ${dateFrom} → ${dateTo}`);

    const { data: dealer, error: dErr } = await supabase
      .from(CONFIG_TABLE)
      .select("client_id, ga4_property_id, account_name")
      .eq("is_active", true)
      .eq("client_id", clientId)
      .maybeSingle();
    if (dErr) return jsonRes({ error: `Config fetch failed: ${dErr.message}`, log: L }, 500);
    if (!dealer) return jsonRes({ error: `No active config for ${clientId}`, log: L }, 400);

    const propertyId = String(dealer.ga4_property_id).replace("properties/", "").trim();
    const accountName = (dealer.account_name as string) || clientId;

    const allDates: string[] = [];
    {
      const d = new Date(dateFrom + "T00:00:00Z");
      const end = new Date(dateTo + "T00:00:00Z");
      if (isNaN(d.getTime()) || isNaN(end.getTime())) {
        return jsonRes({ error: `Invalid date range: ${dateFrom} → ${dateTo}`, log: L }, 400);
      }
      while (d <= end) {
        allDates.push(d.toISOString().split("T")[0]);
        d.setUTCDate(d.getUTCDate() + 1);
      }
    }

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

    const reportUrl = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`;
    const runReport = async (payload: Record<string, unknown>) => {
      const res = await fetch(reportUrl, {
        method: "POST",
        headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`GA4 API ${res.status}: ${await res.text()}`);
      return await res.json();
    };

    // Discovery: which events exist on the property in the window (no DB writes).
    if (listEvents) {
      const r = await runReport({
        dateRanges: [{ startDate: dateFrom, endDate: dateTo }],
        dimensions: [{ name: "eventName" }],
        metrics: [{ name: "eventCount" }],
        orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
        limit: 200,
      });
      const events = (r.rows || []).map(
        (row: { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] }) => ({
          event_name: row.dimensionValues?.[0]?.value,
          event_count: parseInt(row.metricValues?.[0]?.value || "0") || 0,
        })
      );
      return jsonRes({ success: true, window: { from: dateFrom, to: dateTo }, events, log: L });
    }

    let existingDays = new Set<string>();
    if (skipExisting) {
      const { data: existing } = await supabase
        .from(EVENTS_TABLE)
        .select("report_date")
        .eq("client_id", clientId)
        .gte("report_date", dateFrom)
        .lte("report_date", dateTo);
      existingDays = new Set(
        (existing || []).map((r: { report_date: string }) => String(r.report_date).split("T")[0])
      );
    }
    const pendingDays = allDates.filter((d) => !existingDays.has(d));
    log(`days=${allDates.length} pending=${pendingDays.length} events=${eventNames.join(",")}`);

    let totalRows = 0;
    let daysDone = 0;
    let cutoffReached = false;
    const errors: string[] = [];
    const perDay: Record<string, number> = {};

    for (const dateStr of pendingDays) {
      if (Date.now() - startTime > GLOBAL_BUDGET_MS) {
        cutoffReached = true;
        log("⏱️ TIME LIMIT — rerun with skip_existing=true to resume");
        break;
      }
      try {
        const dayRows: Record<string, unknown>[] = [];
        let offset = 0;
        for (;;) {
          const r = await runReport({
            dateRanges: [{ startDate: dateStr, endDate: dateStr }],
            dimensions: [
              { name: "eventName" },
              { name: "pageLocation" },
              { name: "sessionDefaultChannelGroup" },
              { name: "sessionSource" },
              { name: "sessionMedium" },
              { name: "sessionCampaignName" },
            ],
            metrics: [{ name: "eventCount" }, { name: "totalUsers" }],
            dimensionFilter: {
              filter: {
                fieldName: "eventName",
                inListFilter: { values: eventNames },
              },
            },
            limit: PAGE_SIZE,
            offset,
          });
          const rows = r.rows || [];
          for (const row of rows as {
            dimensionValues?: { value?: string }[];
            metricValues?: { value?: string }[];
          }[]) {
            const dv = row.dimensionValues;
            const mv = row.metricValues;
            const loc = dv?.[1]?.value || "";
            const src = dv?.[3]?.value || "(direct)";
            const med = dv?.[4]?.value || "(none)";
            dayRows.push({
              client_id: clientId,
              ga4_property_id: propertyId,
              account_name: accountName,
              report_date: dateStr,
              event_name: dv?.[0]?.value || "",
              page_location: loc,
              page_path: pathFromLocation(loc),
              channel: String(dv?.[2]?.value || "")
                .toLowerCase()
                .replace(/ /g, "_")
                .replace(/\//g, "_"),
              source: src,
              medium: med,
              source_medium: src + " / " + med,
              session_campaign: dv?.[5]?.value || "(not set)",
              event_count: parseInt(mv?.[0]?.value || "0") || 0,
              total_users: parseInt(mv?.[1]?.value || "0") || 0,
            });
          }
          if (rows.length < PAGE_SIZE) break;
          offset += PAGE_SIZE;
          await delay(100);
        }

        // Replace the day only after GA4 returned successfully.
        const { error: delErr } = await supabase
          .from(EVENTS_TABLE)
          .delete()
          .eq("client_id", clientId)
          .eq("report_date", dateStr);
        if (delErr) throw new Error(`delete failed: ${delErr.message}`);

        for (let j = 0; j < dayRows.length; j += CHUNK_SIZE) {
          const { error: insErr } = await supabase
            .from(EVENTS_TABLE)
            .insert(dayRows.slice(j, j + CHUNK_SIZE));
          if (insErr) throw new Error(`insert failed: ${insErr.message}`);
        }
        totalRows += dayRows.length;
        perDay[dateStr] = dayRows.length;
        daysDone++;
        log(`  ✅ ${dateStr}: ${dayRows.length} rows`);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`${dateStr}: ${msg}`);
        log(`  ❌ ${dateStr}: ${msg}`);
        if (/permission|403|forbidden|access denied/i.test(msg)) break;
      }
    }

    return jsonRes({
      success: errors.length === 0,
      cutoff_reached: cutoffReached,
      window: { from: dateFrom, to: dateTo },
      days_total: allDates.length,
      days_pending: pendingDays.length,
      days_done: daysDone,
      rows_inserted: totalRows,
      rows_per_day: perDay,
      errors,
      log: L,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonRes({ error: message, log: L }, 500);
  }
});
