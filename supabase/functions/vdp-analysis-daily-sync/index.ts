import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.3";

/**
 * VDP Analysis daily sync.
 * Calls refresh_vdp_analysis(client, from, to) for active dealers so
 * smart_vdp_inventory_daily / unit_views / channel_pages stay warm.
 *
 * Defaults (daily cron):
 *   - settle = UTC today − 2 (GA4 / Final not final for the last two days)
 *   - refresh only the last 5 settled days (never wider unless explicitly asked)
 *
 * Body:
 *   through, date_from, date_to, fill_month, month,
 *   client_ids[], after_client_id, continue (self-chain)
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SETTLE_DAYS = 2;
const DAILY_DAYS = 5;
const BUDGET_MS = 130_000;
const DEALER_RESERVE_MS = 20_000;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));
const daysIn = (y: number, m: number) => utc(y, m + 1, 0).getUTCDate();
const addDays = (isoDate: string, n: number) => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};
const parseIso = (s: unknown) =>
  typeof s === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    !Number.isNaN(Date.parse(`${s}T00:00:00Z`))
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

/** Split a range into ≤ DAILY_DAYS chunks (inclusive). */
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
    const fillMonth = body.fill_month === true || body.backfill === true;
    const afterClientId =
      typeof body.after_client_id === "string" && body.after_client_id.trim()
        ? body.after_client_id.trim()
        : "";
    const filterIds = Array.isArray(body.client_ids)
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

    const seen = new Set<string>();
    const uniqueWindows = windows.filter((w) => {
      const k = `${w.from}:${w.to}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    push(
      `through=${through} windows=${uniqueWindows.map((w) => `${w.label}:${w.from}→${w.to}`).join(", ")}`,
    );

    const { data: configs, error: cfgErr } = await supabase
      .from("smart_hoot_config")
      .select("ga4_customer_id, customer_name")
      .eq("is_active", true)
      .order("ga4_customer_id", { ascending: true });
    if (cfgErr) throw cfgErr;

    let dealers = [
      ...new Map(
        (configs || [])
          .map((r) => ({
            id: String(r.ga4_customer_id || "").trim(),
            name: String(r.customer_name || "").trim(),
          }))
          .filter((r) => r.id)
          .map((r) => [r.id, r] as const),
      ).values(),
    ].sort((a, b) => a.id.localeCompare(b.id));

    if (filterIds?.length) {
      const allow = new Set(filterIds);
      dealers = dealers.filter((d) => allow.has(d.id));
    }
    if (afterClientId) {
      dealers = dealers.filter((d) => d.id > afterClientId);
    }

    push(`dealers=${dealers.length}${afterClientId ? ` after=${afterClientId}` : ""}`);

    const results: unknown[] = [];
    const errors: string[] = [];
    let lastDone = afterClientId;
    let stoppedEarly = false;

    for (const dealer of dealers) {
      if (Date.now() - started > BUDGET_MS - DEALER_RESERVE_MS) {
        stoppedEarly = true;
        push(`budget: pause after ${lastDone || "(start)"} next=${dealer.id}`);
        break;
      }

      for (const w of uniqueWindows) {
        if (Date.now() - started > BUDGET_MS - DEALER_RESERVE_MS) {
          stoppedEarly = true;
          push(`budget: pause mid-window ${dealer.id} ${w.from}→${w.to}`);
          break;
        }

        const { data, error } = await supabase.rpc("refresh_vdp_analysis", {
          p_client_id: dealer.id,
          p_from: w.from,
          p_to: w.to,
        });
        if (error) {
          const msg = `${dealer.name || dealer.id} ${w.from}→${w.to}: ${error.message}`;
          errors.push(msg);
          push(`ERR ${msg}`);
          continue;
        }
        results.push({ client_id: dealer.id, name: dealer.name, ...w, result: data });
        push(`ok ${dealer.name || dealer.id} ${w.from}→${w.to}`);
      }

      lastDone = dealer.id;
      if (stoppedEarly) break;
    }

    let continued = false;
    if (stoppedEarly && lastDone) {
      const nextBody = {
        ...body,
        after_client_id: lastDone,
        through,
        month: monthParam,
        fill_month: fillMonth,
        date_from: explicitFrom,
        date_to: explicitTo,
        client_ids: filterIds,
        continue: true,
      };
      // Fire-and-forget chain so cron can finish remaining dealers.
      const continueUrl = `${url}/functions/v1/vdp-analysis-daily-sync`;
      fetch(continueUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(nextBody),
      }).catch((err) => console.error("continue invoke failed", err));
      continued = true;
      push(`continue scheduled after_client_id=${lastDone}`);
    }

    return json({
      ok: errors.length === 0,
      through,
      month: monthParam,
      windows: uniqueWindows,
      dealers_total: dealers.length,
      refreshed: results.length,
      last_client_id: lastDone || null,
      continued,
      errors,
      ms: Date.now() - started,
      log,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[vdp-analysis-daily-sync]", message);
    return json({ ok: false, error: message, log }, 500);
  }
});
