/**
 * Daily Conner dealers status email via Google SMTP (nodemailer).
 *
 * One row per active Conner dealer (Scout RV / ScoutX feeds in smart_conner_config):
 *   Feed      — today's smart_conner_inventory snapshot vs the previous snapshot
 *   Final VDP — report day (yesterday IST) GA4 VDP pages vs smart_final_data rows / matched
 *   Step 3    — today's smart_conner_final_data queue run (smart_step3_runs, kind = conner)
 * Data: get_conner_daily_status(p_day). New Conner dealers appear automatically.
 *
 * SMTP: Edge secrets SMTP_USER / SMTP_PASS (same Google app password as daily-scrap-status).
 * Recipients: CONNER_EMAIL_TO / CONNER_EMAIL_CC below; body.to / body.cc override.
 *
 * Manual test: POST {"dry_run":true} or POST {"to":["you@company.com"]}
 * (body.to skips the default CC unless body.cc is also given)
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.9.16";

const REPORT_TIMEZONE = "Asia/Kolkata";
const DEFAULT_SMTP_USER = "devops@brandmirchi.com";
const CONNER_EMAIL_TO = ["aditya@brandmirchi.com"];
const CONNER_EMAIL_CC = ["abdul@brandmirchi.com", "lisa@brandmirchi.com"];

const SMTP_HOST = "smtp.gmail.com";
const SMTP_PORT = 587;
const EMAIL_KIND = "conner_daily_status";
/** Feed counts below this share of the previous snapshot are flagged. */
const FEED_DROP_RATIO = 0.7;
/** Match rates below this are flagged. */
const LOW_MATCH_RATIO = 0.7;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type StatusRpcRow = {
  ga4_customer_id: string;
  customer_name: string;
  website_platform: string | null;
  feed_rows_today: number;
  feed_prev_date: string | null;
  feed_rows_prev: number;
  report_date: string;
  vdp_pages: number;
  final_rows: number;
  final_matched: number;
  step3_status: string | null;
  step3_attempts: number | null;
  step3_finished_at: string | null;
  step3_error: string | null;
};

type DealerStatus = StatusRpcRow & {
  feedOk: boolean;
  feedDrop: boolean;
  step3Label: "DONE" | "ERROR" | "PENDING" | "NOT RUN";
  matchPct: number | null;
  issues: string[];
};

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function todayIst(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function formatDisplayDate(isoDay: string) {
  try {
    return new Date(`${isoDay}T12:00:00+05:30`).toLocaleDateString("en-IN", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: REPORT_TIMEZONE,
    });
  } catch {
    return isoDay;
  }
}

function escapeHtml(s: string) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function parseEmailList(raw: unknown): string[] {
  if (raw == null) return [];
  const parts = Array.isArray(raw) ? raw : String(raw).split(",");
  return parts.map((s) => String(s).trim()).filter((e) => e.includes("@"));
}

function fmt(n: number | null | undefined) {
  return Number(n ?? 0).toLocaleString("en-IN");
}

function pct(v: number | null) {
  return v == null ? "—" : `${Math.round(v * 100)}%`;
}

function toStatus(r: StatusRpcRow): DealerStatus {
  const feedToday = Number(r.feed_rows_today) || 0;
  const feedPrev = Number(r.feed_rows_prev) || 0;
  const finalRows = Number(r.final_rows) || 0;
  const matched = Number(r.final_matched) || 0;
  const vdpPages = Number(r.vdp_pages) || 0;

  const feedOk = feedToday > 0;
  const feedDrop = feedOk && feedPrev > 0 && feedToday < feedPrev * FEED_DROP_RATIO;
  const step3Label =
    r.step3_status === "done"
      ? "DONE"
      : r.step3_status === "error"
        ? "ERROR"
        : r.step3_status
          ? "PENDING"
          : "NOT RUN";
  const matchPct = finalRows > 0 ? matched / finalRows : null;

  const issues: string[] = [];
  if (!feedOk) issues.push("Feed not loaded today");
  if (feedDrop) issues.push(`Feed dropped ${fmt(feedPrev)} → ${fmt(feedToday)}`);
  if (step3Label === "ERROR") issues.push(`Step 3 error: ${r.step3_error ?? "unknown"}`);
  if (step3Label === "PENDING") issues.push("Step 3 still pending");
  if (step3Label === "NOT RUN") issues.push("Step 3 has not run today");
  if (vdpPages === 0) issues.push("No GA4 VDP pages for the report day");
  if (vdpPages > 0 && finalRows === 0) issues.push("VDP pages present but no Final rows");
  if (matchPct != null && matchPct < LOW_MATCH_RATIO) issues.push(`Low match rate ${pct(matchPct)}`);

  return { ...r, feedOk, feedDrop, step3Label, matchPct, issues };
}

function formatText(rows: DealerStatus[], day: string, reportDate: string) {
  const lines = [
    "============================================================",
    "CONNER DEALERS DAILY STATUS",
    `Date        : ${day} (Asia/Kolkata) · Final VDP report day ${reportDate}`,
    `Dealers     : ${rows.length}  |  Feeds loaded: ${rows.filter((r) => r.feedOk).length}  |  Step 3 done: ${rows.filter((r) => r.step3Label === "DONE").length}`,
    "============================================================",
  ];
  for (const r of rows) {
    lines.push(
      `${r.issues.length ? "!!" : "OK"}  ${r.customer_name} (${r.ga4_customer_id}) · feed ${fmt(r.feed_rows_today)} · VDP ${fmt(r.vdp_pages)} · final ${fmt(r.final_rows)} · matched ${fmt(r.final_matched)} (${pct(r.matchPct)}) · step3 ${r.step3Label}`,
    );
    for (const issue of r.issues) lines.push(`      - ${issue}`);
  }
  return lines.join("\n");
}

function statusCsv(rows: DealerStatus[]) {
  const headers = [
    "Dealer", "GA4 Customer ID", "Platform",
    "Feed Units Today", "Previous Snapshot", "Previous Units",
    "Report Date", "VDP Pages", "Final Rows", "Matched", "Match %",
    "Step 3", "Step 3 Attempts", "Issues",
  ];
  const lines = rows.map((r) =>
    [
      r.customer_name, r.ga4_customer_id, r.website_platform ?? "",
      r.feed_rows_today, r.feed_prev_date ?? "", r.feed_rows_prev,
      r.report_date, r.vdp_pages, r.final_rows, r.final_matched, pct(r.matchPct),
      r.step3Label, r.step3_attempts ?? "", r.issues.join("; "),
    ].map(csvCell).join(","),
  );
  return `${headers.join(",")}\n${lines.join("\n")}\n`;
}

function badge(text: string, tone: "ok" | "bad" | "warn" | "muted") {
  const styles = {
    ok: "background:#dcfce7;color:#15803d;",
    bad: "background:#fee2e2;color:#b91c1c;",
    warn: "background:#fef3c7;color:#b45309;",
    muted: "background:#f1f5f9;color:#64748b;",
  }[tone];
  return `<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;${styles}">${escapeHtml(text)}</span>`;
}

function buildHtml(rows: DealerStatus[], day: string, reportDate: string, filename: string) {
  const feedsLoaded = rows.filter((r) => r.feedOk).length;
  const step3Done = rows.filter((r) => r.step3Label === "DONE").length;
  const units = rows.reduce((s, r) => s + (Number(r.feed_rows_today) || 0), 0);
  const finalRows = rows.reduce((s, r) => s + (Number(r.final_rows) || 0), 0);
  const matched = rows.reduce((s, r) => s + (Number(r.final_matched) || 0), 0);
  const attention = rows.filter((r) => r.issues.length);

  const cell = "padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#0f172a;";
  const num = `${cell}text-align:right;font-variant-numeric:tabular-nums;`;
  const th = "padding:8px 10px;font-size:11px;font-weight:600;color:#64748b;";

  const dealerRows = rows.map((r) => {
    const feedBadge = !r.feedOk ? badge("MISSING", "bad") : r.feedDrop ? badge("DROP", "warn") : badge("OK", "ok");
    const stepTone = r.step3Label === "DONE" ? "ok" : r.step3Label === "ERROR" ? "bad" : r.step3Label === "PENDING" ? "warn" : "muted";
    const matchTone = r.matchPct == null ? "muted" : r.matchPct < LOW_MATCH_RATIO ? "bad" : r.matchPct < 0.9 ? "warn" : "ok";
    return `<tr>
      <td style="${cell}">${escapeHtml(r.customer_name)}<br><span style="color:#94a3b8;font-size:11px;">${escapeHtml(r.website_platform ?? "")} · ${escapeHtml(r.ga4_customer_id)}</span></td>
      <td style="${cell}text-align:center;">${feedBadge}</td>
      <td style="${num}">${fmt(r.feed_rows_today)}<br><span style="color:#94a3b8;font-size:11px;">prev ${fmt(r.feed_rows_prev)}</span></td>
      <td style="${num}">${fmt(r.vdp_pages)}</td>
      <td style="${num}">${fmt(r.final_rows)}</td>
      <td style="${cell}text-align:center;">${badge(pct(r.matchPct), matchTone)}</td>
      <td style="${cell}text-align:center;">${badge(r.step3Label, stepTone)}</td>
    </tr>`;
  }).join("");

  const attentionHtml = attention.length
    ? attention.map((r) =>
        `<li style="margin:0 0 6px;font-size:13px;color:#0f172a;"><strong>${escapeHtml(r.customer_name)}</strong>: <span style="color:#b91c1c;">${escapeHtml(r.issues.join(" · "))}</span></li>`,
      ).join("")
    : `<li style="font-size:13px;color:#15803d;">All Conner dealers look healthy today.</li>`;

  const card = (label: string, value: string, sub = "", bg = "#f8fafc") => `
    <td width="50%" style="padding:6px;vertical-align:top;">
      <div style="border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;background:${bg};">
        <p style="margin:0 0 4px;font-size:12px;color:#64748b;">${escapeHtml(label)}</p>
        <p style="margin:0;font-size:22px;font-weight:700;color:#0f172a;">${escapeHtml(value)}</p>
        ${sub ? `<p style="margin:4px 0 0;font-size:12px;color:#64748b;">${escapeHtml(sub)}</p>` : ""}
      </div>
    </td>`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Conner Dealers Daily Status</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:760px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
        <tr><td style="padding:28px 28px 20px;background:#0f172a;">
          <p style="margin:0 0 6px;font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:#93c5fd;">Dealer reporting</p>
          <h1 style="margin:0;font-size:24px;line-height:1.25;font-weight:700;color:#ffffff;">Conner Dealers Daily Status</h1>
          <p style="margin:10px 0 0;font-size:14px;line-height:1.5;color:#cbd5e1;">Scout RV / ScoutX feeds · ${escapeHtml(formatDisplayDate(day))}</p>
        </td></tr>
        <tr><td style="padding:24px 28px;">
          <p style="margin:0 0 16px;font-size:14px;line-height:1.55;color:#334155;">
            Feed load for <strong>${escapeHtml(day)}</strong> and Final VDP (Conner matching) for report day <strong>${escapeHtml(reportDate)}</strong>.
          </p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 18px;">
            <tr>${card("Conner dealers", fmt(rows.length), `${feedsLoaded} feeds loaded today`)}${card("Feed units today", fmt(units))}</tr>
            <tr>${card("Step 3 done", `${step3Done} / ${rows.length}`, "", step3Done === rows.length ? "#f0fdf4" : "#fef2f2")}${card("Final rows matched", `${fmt(matched)} / ${fmt(finalRows)}`, pct(finalRows ? matched / finalRows : null))}</tr>
          </table>

          <h2 style="margin:0 0 8px;font-size:15px;font-weight:600;color:#0f172a;">Needs attention (${attention.length})</h2>
          <ul style="margin:0 0 20px;padding:0 0 0 18px;">${attentionHtml}</ul>

          <h2 style="margin:0 0 10px;font-size:15px;font-weight:600;color:#0f172a;">All Conner dealers (${rows.length})</h2>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;margin:0 0 18px;">
            <tr style="background:#f8fafc;">
              <th align="left" style="${th}">Dealer</th>
              <th align="center" style="${th}">Feed</th>
              <th align="right" style="${th}">Units</th>
              <th align="right" style="${th}">VDP pages</th>
              <th align="right" style="${th}">Final rows</th>
              <th align="center" style="${th}">Match</th>
              <th align="center" style="${th}">Step 3</th>
            </tr>
            ${dealerRows || `<tr><td colspan="7" style="padding:12px;font-size:13px;color:#64748b;">No active Conner dealers.</td></tr>`}
          </table>
          <p style="margin:0;font-size:12px;color:#94a3b8;">Source: get_conner_daily_status · CSV attached: ${escapeHtml(filename)}</p>
        </td></tr>
        <tr><td style="padding:16px 28px 24px;border-top:1px solid #e2e8f0;background:#f8fafc;">
          <p style="margin:0;font-size:12px;line-height:1.5;color:#94a3b8;">Automated daily email from Conner Dealers Status · Smart Analytics</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const dryRun = body?.dry_run === true;
  const skipIfSentToday = body?.skip_if_sent_today === true;
  const day =
    typeof body?.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(String(body.day).slice(0, 10))
      ? String(body.day).slice(0, 10)
      : todayIst();

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  let logId: number | null = null;

  try {
    const { data: logInsert } = await supabase
      .from("smart_inventory_email_log")
      .insert({ started_at: new Date().toISOString(), ok: false, meta: { kind: EMAIL_KIND } })
      .select("id")
      .single();
    if (logInsert?.id) logId = logInsert.id;

    if (skipIfSentToday) {
      const { data: prior } = await supabase
        .from("smart_inventory_email_log")
        .select("id, meta")
        .eq("ok", true)
        .gte("started_at", `${day}T00:00:00+05:30`)
        .limit(50);
      if (prior?.some((row) => row?.meta?.kind === EMAIL_KIND && !row?.meta?.dryRun)) {
        return jsonRes({ email_sent: false, ok: true, skipped: true, message: "Already sent today", day });
      }
    }

    const { data, error } = await supabase.rpc("get_conner_daily_status", { p_day: day });
    if (error) throw new Error(`get_conner_daily_status: ${error.message}`);
    const rows = ((data as StatusRpcRow[] | null) || []).map(toStatus);
    const reportDate = rows[0]?.report_date ?? day;
    const attention = rows.filter((r) => r.issues.length);

    const text = formatText(rows, day, reportDate);
    const csvBytes = new TextEncoder().encode(statusCsv(rows));
    const filename = `conner-dealers-daily-status-${day}.csv`;
    const html = buildHtml(rows, day, reportDate, filename);

    const bodyTo = parseEmailList(body?.to);
    const bodyCc = body?.cc != null ? parseEmailList(body.cc) : null;
    const to = bodyTo.length ? bodyTo : CONNER_EMAIL_TO;
    const cc = bodyCc ?? (bodyTo.length ? [] : CONNER_EMAIL_CC);

    const smtpUser = Deno.env.get("SMTP_USER")?.trim() || DEFAULT_SMTP_USER;
    const smtpPass = (Deno.env.get("SMTP_PASS") ?? "").replace(/\s+/g, "");
    const from = Deno.env.get("INVENTORY_EMAIL_FROM")?.trim() || `Conner Dealers Status <${smtpUser}>`;
    const step3Done = rows.filter((r) => r.step3Label === "DONE").length;
    const subject = `Conner Dealers Daily Status · ${day} · ${step3Done}/${rows.length} built · ${attention.length} need attention`;

    console.log(`\n${text}\n`);

    const logUpdate = (extra: Record<string, unknown>) =>
      logId
        ? supabase.from("smart_inventory_email_log").update({
            finished_at: new Date().toISOString(),
            recipients: to,
            dealer_count: rows.length,
            csv_bytes: csvBytes.byteLength,
            ...extra,
          }).eq("id", logId)
        : Promise.resolve();

    if (dryRun) {
      await logUpdate({ ok: true, meta: { kind: EMAIL_KIND, dryRun: true, attention: attention.length } });
      return jsonRes({ email_sent: false, ok: true, dryRun: true, day, reportDate, to, cc, subject, dealers: rows, text });
    }

    if (!smtpPass) {
      throw new Error("Missing Edge secret SMTP_PASS (Google app password used by daily-scrap-status).");
    }

    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: false,
      auth: { user: smtpUser, pass: smtpPass },
    });
    const info = await transporter.sendMail({
      from,
      to: to.join(", "),
      cc: cc.length ? cc.join(", ") : undefined,
      subject,
      html,
      text,
      attachments: [{ filename, content: csvBytes, contentType: "text/csv" }],
    });

    await logUpdate({
      ok: true,
      provider_id: info.messageId ?? null,
      meta: { kind: EMAIL_KIND, attention: attention.length, transport: "google_smtp" },
    });

    return jsonRes({
      email_sent: true,
      ok: true,
      day,
      reportDate,
      to,
      cc,
      subject,
      attention: attention.map((r) => ({ dealer: r.customer_name, issues: r.issues })),
      smtp_message_id: info.messageId ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[conner-dealers-daily-status] EMAIL NOT SENT —", message);
    if (logId) {
      await supabase
        .from("smart_inventory_email_log")
        .update({ finished_at: new Date().toISOString(), ok: false, error: message })
        .eq("id", logId);
    }
    return jsonRes({ email_sent: false, ok: false, error: message }, 500);
  }
});
