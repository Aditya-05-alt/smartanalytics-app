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
const daysAgoUTC = (n: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().split("T")[0];
};
const isIsoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + "T00:00:00Z"));

function normalizeDate(v: unknown, fallback: string): string {
  const s = (v ?? "").toString().trim().toLowerCase();
  if (!s) return fallback;
  if (s === "today") return todayUTC();
  return s;
}

function pathFromLocation(loc: string) {
  try {
    return new URL(loc).pathname;
  } catch {
    return loc;
  }
}

/** GA4 `date` dimension is YYYYMMDD. */
const isoFromGaDate = (v: string) => `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;

/**
 * GA4 form submit events per dealer -> smart_events_data.
 * Body: one of client_id | client_ids[] | group_id (smart_ga4_config.sync_group) | all:true,
 * plus date_from/date_to or days_back (default: last 4 days). list_events:true (single dealer)
 * returns the property's event names without writing.
 */
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

    const daysBack = Number(body.days_back);
    const dateFrom = Number.isFinite(daysBack) && daysBack > 0
      ? daysAgoUTC(Math.floor(daysBack))
      : normalizeDate(body.date_from ?? body.start_date, daysAgoUTC(4));
    const dateTo = normalizeDate(body.date_to ?? body.end_date, todayUTC());
    if (!isIsoDate(dateFrom) || !isIsoDate(dateTo) || dateFrom > dateTo) {
      return jsonRes({ error: `Invalid date range: ${dateFrom} → ${dateTo}` }, 400);
    }
    const listEvents = body.list_events === true;
    const eventNames = Array.isArray(body.event_names) && body.event_names.length
      ? (body.event_names as unknown[]).map(String)
      : FORM_EVENTS;

    let q = supabase
      .from(CONFIG_TABLE)
      .select("client_id, ga4_property_id, account_name")
      .eq("is_active", true)
      .order("account_name", { ascending: true });
    const singleId = body.client_id ?? body.target_client_id;
    let mode: string;
    if (Array.isArray(body.client_ids) && body.client_ids.length) {
      q = q.in("client_id", (body.client_ids as unknown[]).map(String));
      mode = `${body.client_ids.length} dealer(s)`;
    } else if (singleId) {
      q = q.eq("client_id", String(singleId));
      mode = `dealer ${singleId}`;
    } else if (body.group_id != null) {
      q = q.eq("sync_group", body.group_id);
      mode = `group ${body.group_id}`;
    } else if (body.all === true) {
      mode = "all dealers";
    } else {
      return jsonRes({ error: "Pass client_id, client_ids, group_id or all:true" }, 400);
    }
    const { data: dealers, error: dErr } = await q;
    if (dErr) return jsonRes({ error: `Config fetch failed: ${dErr.message}` }, 500);
    if (!dealers?.length) return jsonRes({ success: true, message: `No active dealers for ${mode}` });

    log(`=== GA4 EVENTS SYNC — ${mode} — ${dateFrom} → ${dateTo}${listEvents ? " (LIST EVENTS)" : ""} ===`);

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

    type GaRow = { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] };
    const runReport = async (propertyId: string, payload: Record<string, unknown>) => {
      const res = await fetch(
        `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
        {
          method: "POST",
          headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok) throw new Error(`GA4 API ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return await res.json();
    };

    if (listEvents) {
      const dealer = dealers[0];
      const propertyId = String(dealer.ga4_property_id).replace("properties/", "").trim();
      const r = await runReport(propertyId, {
        dateRanges: [{ startDate: dateFrom, endDate: dateTo }],
        dimensions: [{ name: "eventName" }],
        metrics: [{ name: "eventCount" }],
        orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
        limit: 200,
      });
      const events = ((r.rows || []) as GaRow[]).map((row) => ({
        event_name: row.dimensionValues?.[0]?.value,
        event_count: parseInt(row.metricValues?.[0]?.value || "0") || 0,
      }));
      return jsonRes({ success: true, dealer: dealer.account_name, window: { from: dateFrom, to: dateTo }, events, log: L });
    }

    const summary: Record<string, unknown>[] = [];
    let cutoffReached = false;

    for (const dealer of dealers) {
      if (Date.now() - startTime > GLOBAL_BUDGET_MS) {
        cutoffReached = true;
        log(`⏱️ Budget reached before ${dealer.account_name}`);
        break;
      }
      const clientId = String(dealer.client_id);
      const propertyId = String(dealer.ga4_property_id).replace("properties/", "").trim();
      const accountName = (dealer.account_name as string) || clientId;
      try {
        const rows: Record<string, unknown>[] = [];
        for (let offset = 0; ; offset += PAGE_SIZE) {
          const r = await runReport(propertyId, {
            dateRanges: [{ startDate: dateFrom, endDate: dateTo }],
            dimensions: [
              { name: "date" },
              { name: "eventName" },
              { name: "pageLocation" },
              { name: "sessionDefaultChannelGroup" },
              { name: "sessionSource" },
              { name: "sessionMedium" },
              { name: "sessionCampaignName" },
            ],
            metrics: [{ name: "eventCount" }, { name: "totalUsers" }],
            dimensionFilter: {
              filter: { fieldName: "eventName", inListFilter: { values: eventNames } },
            },
            limit: PAGE_SIZE,
            offset,
          });
          const page = (r.rows || []) as GaRow[];
          for (const row of page) {
            const dv = row.dimensionValues;
            const mv = row.metricValues;
            const loc = dv?.[2]?.value || "";
            const src = dv?.[4]?.value || "(direct)";
            const med = dv?.[5]?.value || "(none)";
            rows.push({
              client_id: clientId,
              ga4_property_id: propertyId,
              account_name: accountName,
              report_date: isoFromGaDate(dv?.[0]?.value || ""),
              event_name: dv?.[1]?.value || "",
              page_location: loc,
              page_path: pathFromLocation(loc),
              channel: String(dv?.[3]?.value || "")
                .toLowerCase()
                .replace(/ /g, "_")
                .replace(/\//g, "_"),
              source: src,
              medium: med,
              source_medium: src + " / " + med,
              session_campaign: dv?.[6]?.value || "(not set)",
              event_count: parseInt(mv?.[0]?.value || "0") || 0,
              total_users: parseInt(mv?.[1]?.value || "0") || 0,
            });
          }
          if (page.length < PAGE_SIZE) break;
          await delay(100);
        }

        if (!rows.length) {
          log(`  · ${accountName}: no form events from GA4 - stored rows kept`);
          summary.push({ client_id: clientId, account_name: accountName, rows: 0, events: 0 });
          continue;
        }

        // Insert the fresh window first, then drop the older rows of that window (lower ids),
        // so a failed write never leaves the dealer without events.
        const { data: top, error: topErr } = await supabase
          .from(EVENTS_TABLE)
          .select("id")
          .order("id", { ascending: false })
          .limit(1);
        if (topErr) throw new Error(`max id lookup failed: ${topErr.message}`);
        const maxOldId = Number(top?.[0]?.id ?? 0);

        for (let j = 0; j < rows.length; j += CHUNK_SIZE) {
          const { error: insErr } = await supabase.from(EVENTS_TABLE).insert(rows.slice(j, j + CHUNK_SIZE));
          if (insErr) {
            await supabase
              .from(EVENTS_TABLE)
              .delete()
              .eq("client_id", clientId)
              .gte("report_date", dateFrom)
              .lte("report_date", dateTo)
              .gt("id", maxOldId);
            throw new Error(`insert failed: ${insErr.message}`);
          }
        }
        const { error: delErr } = await supabase
          .from(EVENTS_TABLE)
          .delete()
          .eq("client_id", clientId)
          .gte("report_date", dateFrom)
          .lte("report_date", dateTo)
          .lte("id", maxOldId);
        if (delErr) throw new Error(`old-row delete failed: ${delErr.message}`);

        const events = rows.reduce((s, r) => s + (Number(r.event_count) || 0), 0);
        log(`  ✅ ${accountName}: ${rows.length} rows, ${events} events`);
        summary.push({ client_id: clientId, account_name: accountName, rows: rows.length, events });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        log(`  ❌ ${accountName}: ${msg}`);
        summary.push({ client_id: clientId, account_name: accountName, error: msg });
      }
    }

    const failed = summary.filter((s) => s.error).length;
    return jsonRes({
      success: failed === 0 && !cutoffReached,
      cutoff_reached: cutoffReached,
      mode,
      window: { from: dateFrom, to: dateTo },
      dealers: summary,
      log: L,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonRes({ error: message, log: L }, 500);
  }
});
