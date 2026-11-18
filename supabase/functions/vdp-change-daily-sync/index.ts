import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.3";

/**
 * VDP Change daily sync.
 * 1) Insert / refresh Final VDP by channel (smart_event_tracking_vdp_daily)
 * 2) Insert / refresh in-stock units (smart_vdp_inventory_daily via refresh_vdp_change_stock)
 * 3) Fetch GA4 users / sessions / page views for the month-to-date periods get_vdp_change uses
 *
 * Defaults (daily cron):
 *   - settle = UTC today − 2 (GA4 not final for the last two days)
 *   - insert / refresh the last 5 settled days (VDP + stock)
 *   - refresh GA4 traffic for current month-to-date + previous-month compare
 * Set fill_month:true (or date_from/date_to) to also insert the open month from day 1
 * (used for the one-time November backfill).
 * Body: month, through, date_from, date_to, fill_month, skip_vdp, skip_stock, skip_traffic, client_ids[]
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SETTLE_DAYS = 2;
const DAILY_DAYS = 5;
const TRAFFIC_CHUNK = 10;
const BUDGET_MS = 130_000;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));
const daysIn = (y: number, m: number) => utc(y, m + 1, 0).getUTCDate();
const addDays = (isoDate: string, n: number) => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};
const parseIso = (s: unknown) =>
  typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))
    ? s
    : null;

type Window = { from: string; to: string; label: string };

function settleDate(): string {
  const now = new Date();
  return iso(utc(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - SETTLE_DAYS));
}

function monthWindow(month: string, through: string): Window | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return null;
  const y = +m[1];
  const mo = +m[2] - 1;
  const from = iso(utc(y, mo, 1));
  const monthEnd = iso(utc(y, mo, daysIn(y, mo)));
  const to = through < monthEnd ? through : monthEnd;
  if (to < from) return null;
  return { from, to, label: `month:${month}` };
}

function compareWindow(cur: Window): Window {
  const [y, mo] = cur.from.split("-").map(Number);
  const endDay = +cur.to.slice(8, 10);
  const py = mo === 1 ? y - 1 : y;
  const pm = mo === 1 ? 12 : mo - 1;
  const prevEndDay = Math.min(endDay, daysIn(py, pm - 1));
  return {
    from: iso(utc(py, pm - 1, 1)),
    to: iso(utc(py, pm - 1, prevEndDay)),
    label: "compare",
  };
}

function chunkWindows(from: string, to: string, size: number, label: string): Window[] {
  const out: Window[] = [];
  let cursor = from;
  while (cursor <= to) {
    const end = addDays(cursor, size - 1);
    const chunkTo = end < to ? end : to;
    out.push({ from: cursor, to: chunkTo, label });
    cursor = addDays(chunkTo, 1);
  }
  return out;
}

serve(async (req) => {
  const started = Date.now();
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const log: string[] = [];
  const push = (m: string) => {
    log.push(m);
    console.log(m);
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const url = Deno.env.get("SUPABASE_URL") || "";
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!url || !key) throw new Error("Missing SUPABASE config");
    const supabase = createClient(url, key, { auth: { persistSession: false } });

    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      /* empty ok */
    }

    const through = parseIso(body.through) || settleDate();
    const explicitFrom = parseIso(body.date_from);
    const explicitTo = parseIso(body.date_to);
    const skipVdp = body.skip_vdp === true;
    const skipStock = body.skip_stock === true;
    const skipTraffic = body.skip_traffic === true;
    const fillMonth = body.fill_month === true || body.backfill === true;
    const clientIds = Array.isArray(body.client_ids)
      ? (body.client_ids as unknown[]).map(String).filter(Boolean)
      : null;

    const now = new Date();
    const currentMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const monthParam = typeof body.month === "string" ? body.month : currentMonth;

    const windows: Window[] = [];
    if (explicitFrom && explicitTo && explicitFrom <= explicitTo) {
      windows.push(...chunkWindows(explicitFrom, explicitTo, DAILY_DAYS, "explicit"));
    } else {
      const dailyFrom = addDays(through, -(DAILY_DAYS - 1));
      windows.push({ from: dailyFrom, to: through, label: "daily-5" });
      if (fillMonth) {
        const month = monthWindow(monthParam, through);
        if (month) {
          const earlyTo = addDays(dailyFrom, -1);
          if (month.from <= earlyTo) {
            windows.unshift(...chunkWindows(month.from, earlyTo, DAILY_DAYS, month.label));
          }
        }
      }
    }

    // Deduplicate overlapping identical windows
    const seen = new Set<string>();
    const uniqueWindows = windows.filter((w) => {
      const k = `${w.from}:${w.to}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    push(`through=${through} windows=${uniqueWindows.map((w) => `${w.label}:${w.from}→${w.to}`).join(", ")}`);

    const vdp: unknown[] = [];
    const stock: unknown[] = [];

    for (const w of uniqueWindows) {
      if (Date.now() - started > BUDGET_MS - 20_000) {
        push(`budget: stop before ${w.from}→${w.to}`);
        break;
      }

      if (!skipVdp) {
        const { data: vdpData, error: vdpErr } = await supabase.rpc("refresh_event_tracking_vdp", {
          p_from: w.from,
          p_to: w.to,
          p_client_ids: clientIds,
        });
        if (vdpErr) throw new Error(`VDP ${w.from}→${w.to}: ${vdpErr.message}`);
        vdp.push({ ...w, dealers: vdpData });
        push(`vdp ${w.from}→${w.to}: dealers=${vdpData}`);
      }

      if (!skipStock) {
        const { data: stockData, error: stockErr } = await supabase.rpc("refresh_vdp_change_stock", {
          p_from: w.from,
          p_to: w.to,
          p_client_ids: clientIds,
        });
        if (stockErr) throw new Error(`stock ${w.from}→${w.to}: ${stockErr.message}`);
        stock.push(stockData);
        push(`stock ${w.from}→${w.to}: ${JSON.stringify(stockData)}`);
      }
    }

    let traffic: unknown = null;
    if (!skipTraffic) {
      const month = monthWindow(monthParam, through);
      if (!month) throw new Error(`Invalid month ${monthParam}`);
      const prev = compareWindow(month);

      const { data: configs, error: cfgErr } = await supabase
        .from("smart_ga4_config")
        .select("client_id")
        .eq("is_active", true);
      if (cfgErr) throw cfgErr;
      let ids = [...new Set((configs || []).map((r) => String(r.client_id)).filter(Boolean))];
      if (clientIds?.length) ids = ids.filter((id) => clientIds.includes(id));

      const trafficErrors: string[] = [];
      const periods = [month, prev];
      for (const period of periods) {
        for (let i = 0; i < ids.length; i += TRAFFIC_CHUNK) {
          if (Date.now() - started > BUDGET_MS - 15_000) {
            trafficErrors.push("budget: traffic incomplete");
            break;
          }
          const chunk = ids.slice(i, i + TRAFFIC_CHUNK);
          const { error } = await supabase.functions.invoke("smart-ga4-total-users", {
            body: { client_ids: chunk, date_from: period.from, date_to: period.to },
          });
          if (error) trafficErrors.push(`${period.label} ${chunk[0]}…: ${error.message}`);
        }
      }
      traffic = {
        month: { from: month.from, to: month.to },
        compare: { from: prev.from, to: prev.to },
        dealers: ids.length,
        errors: trafficErrors,
      };
      push(`traffic month ${month.from}→${month.to} + compare ${prev.from}→${prev.to}; errors=${trafficErrors.length}`);
    }

    return json({
      ok: true,
      through,
      month: monthParam,
      windows: uniqueWindows,
      vdp,
      stock,
      traffic,
      ms: Date.now() - started,
      log,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[vdp-change-daily-sync]", message);
    return json({ ok: false, error: message, log }, 500);
  }
});
