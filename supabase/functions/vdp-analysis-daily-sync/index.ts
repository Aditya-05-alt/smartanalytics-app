import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.3";
import nodemailer from "npm:nodemailer@6.9.16";

/**
 * VDP Analysis daily sync.
 * Calls refresh_vdp_analysis(client, from, to) for active dealers so
 * smart_vdp_inventory_daily / unit_views / channel_pages stay warm.
 *
 * Defaults (daily cron):
 *   - settle = UTC today − 2 (GA4 / Final not final for the last two days)
 *   - refresh only the last 5 settled days (never wider unless explicitly asked)
 *
 * On the final chain segment (no continue), emails aditya@brandmirchi.com once per through-date.
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

const SMTP_USER = "devops@brandmirchi.com";
const SMTP_HOST = "smtp.gmail.com";
const SMTP_PORT = 587;
const COMPLETE_RECIPIENTS = ["aditya@brandmirchi.com"];

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

function dayLabel(isoDate: string) {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function sendCompleteEmail(opts: {
  supabase: ReturnType<typeof createClient>;
  through: string;
  windows: Window[];
  dealersTotal: number;
  refreshed: number;
  errors: string[];
  ms: number;
}): Promise<{ emailed: boolean; reason?: string }> {
  const { supabase, through, windows, dealersTotal, refreshed, errors, ms } = opts;

  const { data: claim, error: claimErr } = await supabase
    .from("smart_vdp_analysis_complete_email_log")
    .upsert({ through_date: through }, { onConflict: "through_date", ignoreDuplicates: true })
    .select("through_date");
  if (claimErr) throw claimErr;
  if (!claim?.length) return { emailed: false, reason: "already sent" };

  try {
    const pass = (Deno.env.get("SMTP_PASS") ?? "").replace(/\s+/g, "").trim();
    if (!pass) throw new Error("Missing SMTP_PASS Edge secret");
    const user = Deno.env.get("SMTP_USER")?.trim() || SMTP_USER;

    const windowLabel = windows.map((w) => `${w.from} → ${w.to}`).join(", ") || "—";
    const ok = errors.length === 0;
    const subject = ok
      ? `VDP Analysis complete — through ${dayLabel(through)}`
      : `VDP Analysis finished with errors — through ${dayLabel(through)}`;

    const errBlock = errors.length
      ? `<p style="margin:16px 0 0;font-size:13px;color:#b91c1c;"><b>${errors.length} error(s):</b><br>${
        errors.slice(0, 12).map((e) => escapeHtml(e)).join("<br>")
      }${errors.length > 12 ? "<br>…" : ""}</p>`
      : "";

    const html = `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f1f5f9;font-family:Segoe UI,Arial,sans-serif;color:#0f172a;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px;"><tr><td align="center">
<table width="640" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
  <tr><td style="padding:24px 28px;background:#0f172a;color:#fff;">
    <div style="font-size:13px;opacity:.75;letter-spacing:.04em;">SMART ANALYTICS · VDP ANALYSIS</div>
    <div style="font-size:22px;font-weight:700;margin-top:6px;">Daily sync complete</div>
    <div style="font-size:13px;margin-top:8px;opacity:.85;">Settled through ${escapeHtml(dayLabel(through))}</div>
  </td></tr>
  <tr><td style="padding:24px 28px;font-size:14px;line-height:1.55;">
    <p style="margin:0 0 12px;">VDP Analysis daily refresh finished.</p>
    <ul style="margin:0;padding-left:18px;color:#334155;">
      <li>Through date: <b>${escapeHtml(through)}</b></li>
      <li>Windows: ${escapeHtml(windowLabel)}</li>
      <li>Dealers in this run: <b>${dealersTotal}</b></li>
      <li>Refresh calls: <b>${refreshed}</b></li>
      <li>Errors: <b style="color:${ok ? "#15803d" : "#b91c1c"};">${errors.length}</b></li>
      <li>Runtime: ${Math.round(ms / 1000)}s</li>
    </ul>
    ${errBlock}
  </td></tr>
  <tr><td style="padding:16px 28px;border-top:1px solid #e2e8f0;background:#f8fafc;font-size:12px;color:#94a3b8;">
    Automated notice after vdp-analysis-daily-sync · Smart Analytics
  </td></tr>
</table></td></tr></table></body></html>`;

    const text = [
      `VDP Analysis daily sync complete`,
      `Through: ${through} (${dayLabel(through)})`,
      `Windows: ${windowLabel}`,
      `Dealers: ${dealersTotal}`,
      `Refresh calls: ${refreshed}`,
      `Errors: ${errors.length}`,
      `Runtime: ${Math.round(ms / 1000)}s`,
      ...(errors.length ? ["", "Errors:", ...errors.slice(0, 20)] : []),
    ].join("\n");

    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: false,
      auth: { user, pass },
    });
    await transporter.sendMail({
      from: `Smart Analytics <${user}>`,
      to: COMPLETE_RECIPIENTS.join(", "),
      subject,
      html,
      text,
    });

    await supabase
      .from("smart_vdp_analysis_complete_email_log")
      .update({
        sent_at: new Date().toISOString(),
        recipients: COMPLETE_RECIPIENTS,
        dealers: dealersTotal,
        refreshed,
        errors: errors.length,
      })
      .eq("through_date", through);

    return { emailed: true };
  } catch (err) {
    await supabase
      .from("smart_vdp_analysis_complete_email_log")
      .delete()
      .eq("through_date", through)
      .is("sent_at", null);
    throw err;
  }
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

    let email: { emailed: boolean; reason?: string } | null = null;
    if (!continued) {
      try {
        // Full active-dealer count (this segment may only have the tail of a chain).
        const { count: activeDealerCount } = await supabase
          .from("smart_hoot_config")
          .select("ga4_customer_id", { count: "exact", head: true })
          .eq("is_active", true)
          .not("ga4_customer_id", "is", null);
        email = await sendCompleteEmail({
          supabase,
          through,
          windows: uniqueWindows,
          dealersTotal: activeDealerCount ?? dealers.length,
          refreshed: results.length,
          errors,
          ms: Date.now() - started,
        });
        push(
          email.emailed
            ? `complete email sent to ${COMPLETE_RECIPIENTS.join(", ")}`
            : `complete email skipped: ${email.reason || "unknown"}`,
        );
      } catch (mailErr) {
        const msg = mailErr instanceof Error ? mailErr.message : String(mailErr);
        push(`complete email failed: ${msg}`);
        console.error("[vdp-analysis-daily-sync] email", msg);
      }
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
      email,
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
