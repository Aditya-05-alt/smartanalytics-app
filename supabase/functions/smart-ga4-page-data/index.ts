import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { JWT } from "https://esm.sh/google-auth-library@9.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PAGE_TABLE = "smart_ga4_page_data";
const CONFIG_TABLE = "smart_ga4_config";
const CHUNK_SIZE = 500;
const GLOBAL_BUDGET_MS = 130_000;
const DEALER_BUDGET_MS = 100_000;
const PAGE_SIZE = 1500;

/** Dealers that store pathname+query in page_path_q_s (page_path stays pathname-only). */
const PAGE_PATH_QS_CLIENT_IDS = new Set(["1421445735"]);

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const todayUTC = () => new Date().toISOString().split("T")[0];

const normalizeDate = (v: unknown): string => {
  const s = (v ?? "").toString().trim().toLowerCase();
  if (!s || s === "today") return todayUTC();
  return s;
};

function pathsFromLocation(loc: string, clientId: string) {
  try {
    const u = new URL(loc);
    const pathname = u.pathname;
    const page_path_q_s = PAGE_PATH_QS_CLIENT_IDS.has(clientId)
      ? pathname + u.search
      : null;
    return { page_path: pathname, page_path_q_s };
  } catch {
    return { page_path: loc, page_path_q_s: null };
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

    const targetClientId =
      (body.target_client_id as string) ?? (body.client_id as string) ?? null;
    const groupId = (body.group_id as string | number | null) ?? null;
    const dateFrom = normalizeDate(body.date_from ?? body.start_date ?? "2026-05-20");
    const dateTo = normalizeDate(body.date_to ?? body.end_date ?? todayUTC());

    const modeLabel = targetClientId
      ? `SINGLE DEALER ${targetClientId}`
      : groupId !== null
        ? `Group ${groupId}`
        : "ALL DEALERS";

    log(`=== GA4 PAGE SYNC V31 (page_path_q_s for opted-in dealers) — ${modeLabel} ===`);
    log(`Window: ${dateFrom} → ${dateTo}`);

    let q = supabase
      .from(CONFIG_TABLE)
      .select("client_id, ga4_property_id, account_name")
      .eq("is_active", true)
      .order("account_name", { ascending: true });
    if (targetClientId) q = q.eq("client_id", targetClientId);
    else if (groupId !== null) q = q.eq("sync_group", groupId);

    const { data: dealers, error: dErr } = await q;

    if (dErr) {
      log(`❌ Config fetch error: ${dErr.message}`);
      return jsonRes({ error: `Config fetch failed: ${dErr.message}`, log: L }, 500);
    }
    if (!dealers || dealers.length === 0) {
      return jsonRes({ error: `No active dealers found for ${modeLabel}`, log: L }, 400);
    }
    log(`Found ${dealers.length} active dealer(s)`);

    const allDates: string[] = [];
    {
      const d = new Date(dateFrom + "T00:00:00Z");
      const end = new Date(dateTo + "T00:00:00Z");
      if (isNaN(d.getTime()) || isNaN(end.getTime())) {
        return jsonRes(
          { error: `Invalid date range: ${dateFrom} → ${dateTo}`, log: L },
          400
        );
      }
      while (d <= end) {
        allDates.push(d.toISOString().split("T")[0]);
        d.setUTCDate(d.getUTCDate() + 1);
      }
    }
    if (allDates.length === 0) {
      return jsonRes(
        { error: `Date range produced 0 days: ${dateFrom} → ${dateTo}`, log: L },
        400
      );
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

    const droppedInsertCols = new Set<string>();

    const safeStatusUpdate = async (clientId: string, status: string) => {
      if ((safeStatusUpdate as { disabled?: boolean }).disabled) return;
      try {
        const { error } = await supabase
          .from(CONFIG_TABLE)
          .update({ sync_status: status })
          .eq("client_id", clientId);
        if (error && /sync_status.*does not exist/i.test(error.message)) {
          (safeStatusUpdate as { disabled?: boolean }).disabled = true;
          log("  ⚠️ sync_status column missing — disabling status updates");
        }
      } catch {
        /* ignore */
      }
    };

    async function insertResilient(rows: Record<string, unknown>[]) {
      let working = rows;
      if (droppedInsertCols.size > 0) {
        working = working.map((r) => {
          const c = { ...r };
          for (const k of droppedInsertCols) delete c[k];
          return c;
        });
      }
      for (let attempt = 0; attempt < 5; attempt++) {
        const { error } = await supabase.from(PAGE_TABLE).insert(working);
        if (!error) return { inserted: working.length, error: null };
        const msg = error.message || "";
        const m = msg.match(
          /column\s+"?([a-zA-Z0-9_]+)"?\s+(?:of relation\s+\S+\s+)?does not exist/i
        );
        if (m?.[1] && !droppedInsertCols.has(m[1])) {
          droppedInsertCols.add(m[1]);
          log(`  ⚠️ Stripping unknown column: ${m[1]}`);
          working = working.map((r) => {
            const c = { ...r };
            delete c[m[1]];
            return c;
          });
          continue;
        }
        return { inserted: 0, error };
      }
      return { inserted: 0, error: new Error("Too many missing columns") };
    }

    let totalGlobalRows = 0;
    let cutoffReached = false;
    const dealerSummary: Record<string, unknown>[] = [];

    for (const dealer of dealers) {
      if (Date.now() - startTime > GLOBAL_BUDGET_MS) {
        log(`⏱️ GLOBAL TIME LIMIT — stopping before ${dealer.account_name || dealer.client_id}`);
        cutoffReached = true;
        break;
      }

      const CLIENT_ID = dealer.client_id as string;
      const propertyId = String(dealer.ga4_property_id).replace("properties/", "").trim();
      const accountName = (dealer.account_name as string) || CLIENT_ID;
      const dealerStart = Date.now();
      let dealerRows = 0;
      let dealerDays = 0;
      let dealerError: string | null = null;

      log(`\n🚀 [${accountName}] client=${CLIENT_ID} prop=${propertyId}`);
      await safeStatusUpdate(CLIENT_ID, "🔄 Processing...");

      const { data: existing, error: exErr } = await supabase
        .from(PAGE_TABLE)
        .select("report_date")
        .eq("client_id", CLIENT_ID)
        .gte("report_date", dateFrom)
        .lte("report_date", dateTo);

      if (exErr) log(`  ⚠️ [${accountName}] existing-query error: ${exErr.message}`);
      const doneDays = new Set<string>();
      if (existing) {
        existing.forEach((r: { report_date: string }) =>
          doneDays.add(String(r.report_date).split("T")[0])
        );
      }
      const pendingDays = allDates.filter((d) => !doneDays.has(d));

      log(`  [${accountName}] filled=${doneDays.size} | pending=${pendingDays.length}`);

      if (pendingDays.length === 0) {
        log(`  ✅ [${accountName}] Already complete`);
        await safeStatusUpdate(CLIENT_ID, "✅ Complete");
        dealerSummary.push({
          account_name: accountName,
          client_id: CLIENT_ID,
          status: "complete",
          rows: 0,
          days_processed: 0,
          days_pending: 0,
        });
        continue;
      }

      for (const dateStr of pendingDays) {
        if (Date.now() - startTime > GLOBAL_BUDGET_MS) {
          cutoffReached = true;
          break;
        }
        if (Date.now() - dealerStart > DEALER_BUDGET_MS) {
          log(`  ⏭️ [${accountName}] Dealer budget hit — will resume next run`);
          break;
        }

        try {
          await safeStatusUpdate(CLIENT_ID, `🔄 ${dateStr}`);
          await supabase
            .from(PAGE_TABLE)
            .delete()
            .eq("client_id", CLIENT_ID)
            .eq("report_date", dateStr);

          let offset = 0;
          let hasMore = true;
          let dayRows = 0;

          while (hasMore) {
            const url = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`;
            const res = await fetch(url, {
              method: "POST",
              headers: {
                Authorization: "Bearer " + TOKEN,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                dateRanges: [{ startDate: dateStr, endDate: dateStr }],
                dimensions: [
                  { name: "pageLocation" },
                  { name: "pageTitle" },
                  { name: "sessionDefaultChannelGroup" },
                  { name: "sessionSource" },
                  { name: "sessionMedium" },
                  { name: "sessionCampaignName" },
                ],
                metrics: [
                  { name: "screenPageViews" },
                  { name: "totalUsers" },
                  { name: "newUsers" },
                  { name: "sessions" },
                ],
                limit: PAGE_SIZE,
                offset,
              }),
            });

            if (!res.ok) {
              const txt = await res.text();
              throw new Error(`GA4 API ${res.status}: ${txt}`);
            }
            const r2 = await res.json();
            const rows = r2.rows || [];
            if (rows.length === 0) {
              hasMore = false;
              break;
            }

            const pageData = rows.map((row: { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] }) => {
              const dv = row.dimensionValues;
              const mv = row.metricValues;
              const loc = dv?.[0]?.value || "";
              const { page_path, page_path_q_s } = pathsFromLocation(loc, CLIENT_ID);
              const src = dv?.[3]?.value || "(direct)";
              const med = dv?.[4]?.value || "(none)";
              return {
                client_id: CLIENT_ID,
                ga4_property_id: propertyId,
                account_name: accountName,
                report_date: dateStr,
                page_location: loc,
                page_path,
                page_path_q_s,
                page_title: dv?.[1]?.value || "",
                channel: String(dv?.[2]?.value || "")
                  .toLowerCase()
                  .replace(/ /g, "_")
                  .replace(/\//g, "_"),
                source: src,
                medium: med,
                source_medium: src + " / " + med,
                session_campaign: dv?.[5]?.value || "(not set)",
                views: parseInt(mv?.[0]?.value || "0") || 0,
                total_users: parseInt(mv?.[1]?.value || "0") || 0,
                new_users: parseInt(mv?.[2]?.value || "0") || 0,
                sessions: parseInt(mv?.[3]?.value || "0") || 0,
                ga4_page_type: null,
                vdp_conditions: false,
              };
            });

            for (let j = 0; j < pageData.length; j += CHUNK_SIZE) {
              const chunk = pageData.slice(j, j + CHUNK_SIZE);
              const { inserted, error: insErr } = await insertResilient(chunk);
              if (insErr) {
                log(`  ❌ [${accountName}] INSERT ERROR ${dateStr}: ${insErr.message}`);
              } else {
                totalGlobalRows += inserted;
                dealerRows += inserted;
                dayRows += inserted;
              }
              await delay(5);
            }

            if (rows.length < PAGE_SIZE) hasMore = false;
            else {
              offset += PAGE_SIZE;
              await delay(100);
            }
          }

          dealerDays++;
          log(`  ✅ [${accountName}] ${dateStr}: ${dayRows} rows`);
        } catch (e: unknown) {
          dealerError = e instanceof Error ? e.message : String(e);
          log(`  ❌ [${accountName}] ${dateStr}: ${dealerError}`);
          await supabase
            .from(PAGE_TABLE)
            .delete()
            .eq("client_id", CLIENT_ID)
            .eq("report_date", dateStr);

          if (/permission|403|forbidden|access denied/i.test(dealerError)) {
            log(`  ⚠️ [${accountName}] Permission denied — skipping rest of dealer`);
            await safeStatusUpdate(CLIENT_ID, "❌ No access");
            break;
          }
        }
      }

      const isComplete = dealerDays === pendingDays.length && !dealerError;
      await safeStatusUpdate(
        CLIENT_ID,
        isComplete
          ? "✅ Complete"
          : dealerError
            ? `⚠️ Partial (${dealerError.slice(0, 40)})`
            : `⏭️ Resumable (${dealerDays}/${pendingDays.length})`
      );

      dealerSummary.push({
        account_name: accountName,
        client_id: CLIENT_ID,
        status: isComplete ? "complete" : dealerError ? "error" : "partial",
        rows: dealerRows,
        days_processed: dealerDays,
        days_pending: pendingDays.length,
        error: dealerError,
        elapsed_ms: Date.now() - dealerStart,
      });

      if (cutoffReached) break;
    }

    log(
      `\n=== RUN DONE === dealers ${dealerSummary.length}/${dealers.length} | rows=${totalGlobalRows} | cutoff=${cutoffReached}`
    );

    dealerSummary.sort(
      (a, b) => ((b.rows as number) || 0) - ((a.rows as number) || 0)
    );

    return jsonRes({
      success: true,
      cutoff_reached: cutoffReached,
      mode: modeLabel,
      window: { from: dateFrom, to: dateTo },
      total_dealers: dealers.length,
      processed_dealers: dealerSummary.length,
      rows_inserted: totalGlobalRows,
      dealers: dealerSummary,
      log: L,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonRes({ error: message, log: L }, 500);
  }
});
