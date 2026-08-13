/**
 * Daily Hoot dealers transfer email via Google SMTP (nodemailer).
 *
 * Lists every active Hoot dealer (hoot_url set) and whether today's inventory
 * was upserted into smart_hoot_inventory, with row counts.
 *
 * Hoot source:
 *   smart_hoot_inventory — match by customer_name
 *   transmitted today = rows where last_seen (fallback first_seen) is today IST
 *   (table has first_seen / last_seen only — no updated_at)
 *
 * Google SMTP: set SMTP_USER / SMTP_PASS below, OR Edge secrets with the same names
 * (secrets win when in-file pass is empty — safe for deploy).
 * Recipients: INVENTORY_EMAIL_TO below; secret / DB config / body.to can override.
 * Optional secret INVENTORY_EMAIL_FROM overrides the default From header.
 *
 * App password: Google Account → Security → 2-Step Verification → App passwords.
 * Report date uses Asia/Kolkata (IST).
 *
 * Supabase (auto): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Manual test: POST {} or POST {"dry_run":true} or POST {"to":["you@company.com"]}
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.9.16";

const REPORT_TIMEZONE = "Asia/Kolkata";

/** Google Workspace / Gmail SMTP — edit here (do not push real passwords to public repos). */
const SMTP_USER = "devops@brandmirchi.com";
/** Prefer Edge secret SMTP_PASS when set. */
const SMTP_PASS = "";
/** Primary recipient(s). */
const INVENTORY_EMAIL_TO = [
  "lisa@brandmirchi.com",
  "adops@brandmirchi.com",
];
/** CC recipient(s). */
const INVENTORY_EMAIL_CC = [
  "aditya@brandmirchi.com",
];

const SMTP_HOST = "smtp.gmail.com";
const SMTP_PORT = 587;
const SMTP_SECURE = false;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PAGE = 1000;
const EMAIL_KIND = "hoot_daily_status";

type HootDealer = {
  customer_name: string;
  ga4_customer_id: string;
  hoot_url?: string;
};

type StatusRow = {
  report_date: string;
  ga4_customer_id: string;
  dealer_name: string;
  transmitted: boolean;
  live_units: number;
  transferred_units: number;
  first_seen_today: number;
  last_seen: string | null;
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
    const d = new Date(`${isoDay}T12:00:00+05:30`);
    return d.toLocaleDateString("en-IN", {
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

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

async function fetchPaged(
  // deno-lint-ignore no-explicit-any
  queryFactory: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: any }>,
) {
  const rows: Record<string, unknown>[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await queryFactory(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return rows;
}

/**
 * Hoot inventory for today IST using first_seen / last_seen only.
 * Prefer rows with last_seen today; also count first_seen today as upserted.
 */
async function fetchTodayHoot(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  reportDate: string,
): Promise<{ rows: Record<string, unknown>[]; hootAsOf: string; hootSource: string }> {
  const dayStart = `${reportDate}T00:00:00+05:30`;
  const dayEnd = `${reportDate}T23:59:59.999+05:30`;

  // Rows touched today (upsert refresh) — last_seen in IST day
  const byLastSeen = await fetchPaged((from, to) =>
    supabase
      .from("smart_hoot_inventory")
      .select(
        "sk,vin,url,advertiser,make,model,year,price,condition,customer_name,location,msrp,type_,trim,stock_number,first_seen,last_seen,website_platform",
      )
      .gte("last_seen", dayStart)
      .lte("last_seen", dayEnd)
      .order("customer_name", { ascending: true })
      .order("sk", { ascending: true })
      .range(from, to),
  );

  if (byLastSeen.length > 0) {
    return {
      rows: byLastSeen,
      hootAsOf: reportDate,
      hootSource: "smart_hoot_inventory(last_seen=today)",
    };
  }

  // Fallback: newly inserted today (first_seen)
  const byFirstSeen = await fetchPaged((from, to) =>
    supabase
      .from("smart_hoot_inventory")
      .select(
        "sk,vin,url,advertiser,make,model,year,price,condition,customer_name,location,msrp,type_,trim,stock_number,first_seen,last_seen,website_platform",
      )
      .gte("first_seen", dayStart)
      .lte("first_seen", dayEnd)
      .order("customer_name", { ascending: true })
      .order("sk", { ascending: true })
      .range(from, to),
  );

  return {
    rows: byFirstSeen,
    hootAsOf: reportDate,
    hootSource: "smart_hoot_inventory(first_seen=today)",
  };
}

function isPlaceholderEmail(email: string) {
  const e = email.toLowerCase();
  return (
    !e ||
    e.includes("example.com") ||
    e.includes("replace_with") ||
    e === "you@company.com"
  );
}

function parseEmailList(raw: string | string[] | null | undefined): string[] {
  if (raw == null) return [];
  const parts = Array.isArray(raw) ? raw : String(raw).split(",");
  return parts
    .map((s) => String(s).trim())
    .filter((e) => e && !isPlaceholderEmail(e));
}

function escapeHtml(s: string) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function keyId(value: unknown) {
  return String(value ?? "").trim();
}

function keyName(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function countHootByDealer(hootRows: Record<string, unknown>[]) {
  const byName = new Map<string, number>();
  for (const row of hootRows) {
    const name = keyName(row.customer_name);
    if (name) byName.set(name, (byName.get(name) || 0) + 1);
  }
  return byName;
}

function buildStatusRows(
  dealers: HootDealer[],
  hootRows: Record<string, unknown>[],
  reportDate: string,
): StatusRow[] {
  const byName = countHootByDealer(hootRows);
  return dealers
    .map((d) => {
      const id = keyId(d.ga4_customer_id);
      const name = String(d.customer_name ?? "").trim();
      const units = byName.get(keyName(name)) || 0;
      return {
        report_date: reportDate,
        ga4_customer_id: id,
        dealer_name: name || id || "—",
        transmitted: units > 0,
        live_units: units,
        transferred_units: units,
        first_seen_today: units,
        last_seen: null,
      };
    })
    .sort((a, b) => a.dealer_name.localeCompare(b.dealer_name));
}

function pad(value: string | number, width: number, align: "left" | "right" = "left") {
  const s = String(value ?? "");
  if (s.length >= width) return s.slice(0, width);
  const space = " ".repeat(width - s.length);
  return align === "right" ? space + s : s + space;
}

function formatReport(
  rows: StatusRow[],
  reportDate: string,
  hootSource: string,
  hootAsOf: string,
) {
  const total = rows.length;
  const yes = rows.filter((r) => r.transmitted).length;
  const no = total - yes;
  const unitsToday = rows.reduce((sum, r) => sum + (Number(r.transferred_units) || 0), 0);

  const lines = [
    "============================================================",
    "HOOT DEALERS DAILY STATUS",
    `Report date : ${reportDate} (Asia/Kolkata)`,
    `Hoot as of  : ${hootAsOf}`,
    `Source      : ${hootSource}`,
    `Dealers     : ${total}  |  Transmitted: ${yes}  |  Missing: ${no}`,
    `Rows upserted today : ${unitsToday.toLocaleString("en-IN")}`,
    "============================================================",
    `${pad("#", 3)}  ${pad("Status", 6)}  ${pad("Dealer", 36)}  ${pad("Rows", 8, "right")}`,
    "------------------------------------------------------------",
  ];

  rows.forEach((row, i) => {
    lines.push(
      `${pad(i + 1, 3, "right")}  ${pad(row.transmitted ? "YES" : "NO", 6)}  ${pad(row.dealer_name || "—", 36)}  ${pad(Number(row.transferred_units) || 0, 8, "right")}`,
    );
  });

  const missing = rows.filter((r) => !r.transmitted);
  lines.push("------------------------------------------------------------");
  if (missing.length) {
    lines.push("MISSING (no hoot upsert today):");
    for (const row of missing) {
      lines.push(`  - ${row.dealer_name}  (${row.ga4_customer_id})`);
    }
  } else {
    lines.push("All hoot dealers have inventory upserted today.");
  }
  lines.push("============================================================");
  return lines.join("\n");
}

function statusCsv(rows: StatusRow[]) {
  const headers = [
    "Status",
    "Dealer Name",
    "GA4 Customer ID",
    "Rows Upserted Today",
    "Transmitted",
    "Report Date",
  ];
  const lines = rows.map((r) =>
    [
      r.transmitted ? "YES" : "NO",
      r.dealer_name,
      r.ga4_customer_id,
      r.transferred_units,
      r.transmitted,
      r.report_date,
    ]
      .map(csvCell)
      .join(","),
  );
  return `${headers.join(",")}\n${lines.join("\n")}\n`;
}

function buildHtmlEmail(opts: {
  reportDate: string;
  rows: StatusRow[];
  hootAsOf: string;
  hootSource: string;
  filename: string;
}) {
  const { reportDate, rows, hootAsOf, hootSource, filename } = opts;
  const displayDate = formatDisplayDate(reportDate);
  const yes = rows.filter((r) => r.transmitted);
  const no = rows.filter((r) => !r.transmitted);
  const units = rows.reduce((s, r) => s + (Number(r.transferred_units) || 0), 0);

  const dealerHtml = rows
    .map(
      (r) =>
        `<tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#0f172a;">${escapeHtml(r.dealer_name)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;text-align:center;">
            <span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;${
              r.transmitted
                ? "background:#dcfce7;color:#15803d;"
                : "background:#fee2e2;color:#b91c1c;"
            }">${r.transmitted ? "YES" : "NO"}</span>
          </td>
          <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#0f172a;text-align:right;font-variant-numeric:tabular-nums;">${Number(r.transferred_units).toLocaleString("en-IN")}</td>
        </tr>`,
    )
    .join("");

  const missingHtml = no.length
    ? no
        .map(
          (r) =>
            `<li style="margin:0 0 4px;font-size:13px;color:#b91c1c;">${escapeHtml(r.dealer_name)} <span style="color:#94a3b8;">(${escapeHtml(r.ga4_customer_id)})</span></li>`,
        )
        .join("")
    : `<li style="font-size:13px;color:#15803d;">All hoot dealers have inventory upserted today.</li>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Hoot Dealers Daily Status</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
          <tr>
            <td style="padding:28px 28px 20px;background:#0f172a;">
              <p style="margin:0 0 6px;font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:#93c5fd;">Dealer reporting</p>
              <h1 style="margin:0;font-size:24px;line-height:1.25;font-weight:700;color:#ffffff;">Hoot Dealers Daily Status</h1>
              <p style="margin:10px 0 0;font-size:14px;line-height:1.5;color:#cbd5e1;">All Hoot dealers · ${escapeHtml(displayDate)}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 28px;">
              <p style="margin:0 0 18px;font-size:14px;line-height:1.55;color:#334155;">
                Daily check for <strong style="color:#0f172a;">every Hoot dealer</strong>.
                Counts rows upserted into <strong>smart_hoot_inventory</strong> today
                (by <code>last_seen</code> / <code>first_seen</code>, as of ${escapeHtml(hootAsOf)}).
              </p>

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 20px;">
                <tr>
                  <td width="50%" style="padding:0 6px 12px 0;vertical-align:top;">
                    <div style="border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;background:#f8fafc;">
                      <p style="margin:0 0 4px;font-size:12px;color:#64748b;">Hoot dealers</p>
                      <p style="margin:0;font-size:22px;font-weight:700;color:#0f172a;">${rows.length.toLocaleString("en-IN")}</p>
                    </div>
                  </td>
                  <td width="50%" style="padding:0 0 12px 6px;vertical-align:top;">
                    <div style="border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;background:#f8fafc;">
                      <p style="margin:0 0 4px;font-size:12px;color:#64748b;">Rows upserted today</p>
                      <p style="margin:0;font-size:22px;font-weight:700;color:#0f172a;">${units.toLocaleString("en-IN")}</p>
                    </div>
                  </td>
                </tr>
                <tr>
                  <td width="50%" style="padding:0 6px 0 0;vertical-align:top;">
                    <div style="border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;background:#eff6ff;">
                      <p style="margin:0 0 4px;font-size:12px;color:#64748b;">Transmitted</p>
                      <p style="margin:0;font-size:20px;font-weight:700;color:#1d4ed8;">${yes.length.toLocaleString("en-IN")}</p>
                    </div>
                  </td>
                  <td width="50%" style="padding:0 0 0 6px;vertical-align:top;">
                    <div style="border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;background:#fef2f2;">
                      <p style="margin:0 0 4px;font-size:12px;color:#64748b;">Missing</p>
                      <p style="margin:0;font-size:20px;font-weight:700;color:#b91c1c;">${no.length.toLocaleString("en-IN")}</p>
                    </div>
                  </td>
                </tr>
              </table>

              <h2 style="margin:0 0 10px;font-size:15px;font-weight:600;color:#0f172a;">All Hoot dealers</h2>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;margin:0 0 22px;">
                <tr style="background:#f8fafc;">
                  <th align="left" style="padding:8px 12px;font-size:12px;font-weight:600;color:#64748b;">Dealer</th>
                  <th align="center" style="padding:8px 12px;font-size:12px;font-weight:600;color:#64748b;">Sent</th>
                  <th align="right" style="padding:8px 12px;font-size:12px;font-weight:600;color:#64748b;">Rows</th>
                </tr>
                ${dealerHtml || `<tr><td colspan="3" style="padding:12px;font-size:13px;color:#64748b;">No Hoot dealers with hoot_url</td></tr>`}
              </table>

              <h2 style="margin:0 0 8px;font-size:15px;font-weight:600;color:#0f172a;">Missing today</h2>
              <ul style="margin:0 0 18px;padding:0 0 0 18px;">${missingHtml}</ul>

              <p style="margin:0;font-size:12px;color:#94a3b8;">Source: ${escapeHtml(hootSource)} · CSV attached: ${escapeHtml(filename)}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px 24px;border-top:1px solid #e2e8f0;background:#f8fafc;">
              <p style="margin:0;font-size:12px;line-height:1.5;color:#94a3b8;">
                Automated daily email from Hoot Dealers Status · Smart Analytics
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function resolvedSmtpAuth(): { user: string; pass: string } {
  const user = Deno.env.get("SMTP_USER")?.trim() || SMTP_USER.trim();
  const passEnv = (Deno.env.get("SMTP_PASS") ?? "").replace(/\s+/g, "").trim();
  const passInline = SMTP_PASS.replace(/\s+/g, "").trim();
  return { user, pass: passEnv || passInline };
}

async function sendViaSmtp(params: {
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  html: string;
  text?: string;
  attachments?: { filename: string; content: Uint8Array; contentType: string }[];
}): Promise<{ messageId?: string }> {
  const { user, pass } = resolvedSmtpAuth();
  if (!user || !pass) {
    throw new Error(
      "Missing SMTP credentials: set SMTP_USER + SMTP_PASS in this file, or Edge secrets SMTP_USER and SMTP_PASS (Google App Password).",
    );
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: { user, pass },
  });

  const info = await transporter.sendMail({
    from: params.from,
    to: params.to.join(", "),
    cc: params.cc?.length ? params.cc.join(", ") : undefined,
    subject: params.subject,
    html: params.html,
    text: params.text,
    attachments: params.attachments?.map((a) => ({
      filename: a.filename,
      content: a.content,
      contentType: a.contentType,
    })),
  });

  return { messageId: info.messageId };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const dryRun = body?.dry_run === true;
  const skipIfSentToday = body?.skip_if_sent_today === true;
  const reportDate =
    typeof body?.report_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.report_date.slice(0, 10))
      ? String(body.report_date).slice(0, 10)
      : todayIst();

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) {
    return jsonRes(
      { email_sent: false, ok: false, error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" },
      500,
    );
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  let logId: number | null = null;

  try {
    const { data: logInsert, error: logErr } = await supabase
      .from("smart_inventory_email_log")
      .insert({ started_at: new Date().toISOString(), ok: false, meta: { kind: EMAIL_KIND } })
      .select("id")
      .single();
    if (!logErr && logInsert?.id) logId = logInsert.id;

    if (skipIfSentToday) {
      const dayStart = `${reportDate}T00:00:00+05:30`;
      const { data: prior } = await supabase
        .from("smart_inventory_email_log")
        .select("id, meta")
        .eq("ok", true)
        .gte("started_at", dayStart)
        .limit(20);
      if (prior?.some((row) => row?.meta?.kind === EMAIL_KIND)) {
        return jsonRes({
          email_sent: false,
          ok: true,
          skipped: true,
          message: "Already sent hoot daily status successfully today",
          reportDate,
        });
      }
    }

    const { data: cfg } = await supabase
      .from("smart_inventory_email_config")
      .select("*")
      .eq("id", 1)
      .maybeSingle();

    if (cfg && cfg.enabled === false) {
      return jsonRes({
        email_sent: false,
        ok: true,
        skipped: true,
        message: "Email disabled in smart_inventory_email_config",
      });
    }

    const bodyTo = Array.isArray(body?.to)
      ? (body.to as unknown[]).map((x) => String(x).trim()).filter(Boolean)
      : typeof body?.to === "string"
      ? parseEmailList(String(body.to))
      : [];

    const secretTo = parseEmailList(Deno.env.get("INVENTORY_EMAIL_TO")?.trim() || "");
    const inlineTo = parseEmailList(INVENTORY_EMAIL_TO);
    const dbTo = Array.isArray(cfg?.recipients)
      ? cfg.recipients.map((x: string) => String(x).trim()).filter((e: string) => !isPlaceholderEmail(e))
      : [];

    const recipients =
      bodyTo.length > 0
        ? bodyTo.filter((e) => !isPlaceholderEmail(e))
        : secretTo.length > 0
        ? secretTo
        : inlineTo.length > 0
        ? inlineTo
        : dbTo;

    if (!recipients.length) {
      return jsonRes({
        email_sent: false,
        ok: false,
        skipped: true,
        reason:
          "Set INVENTORY_EMAIL_TO in this file, Edge secret INVENTORY_EMAIL_TO, body.to, or smart_inventory_email_config.recipients",
        reportDate,
      });
    }

    const secretCc = parseEmailList(Deno.env.get("INVENTORY_EMAIL_CC")?.trim() || "");
    const inlineCc = parseEmailList(INVENTORY_EMAIL_CC);
    const dbCc = Array.isArray(cfg?.cc_recipients)
      ? cfg.cc_recipients.map((x: string) => String(x).trim()).filter((e: string) => !isPlaceholderEmail(e))
      : [];
    const cc =
      secretCc.length > 0 ? secretCc : inlineCc.length > 0 ? inlineCc : dbCc;

    console.log(`[hoot-dealers-daily-status] Loading hoot dealers + today's inventory for ${reportDate}…`);

    const { data: dealerRows, error: dealerErr } = await supabase.rpc(
      "get_hoot_dealers_for_sync",
      { p_client_id: null },
    );
    if (dealerErr) {
      throw new Error(
        `${dealerErr.message} — deploy supabase/rpc/snapshot_hoot_dealers_daily_status.sql`,
      );
    }

    const dealers = ((dealerRows || []) as HootDealer[]).filter(
      (d) => keyId(d.ga4_customer_id) || String(d.customer_name ?? "").trim(),
    );

    const hootPack = await fetchTodayHoot(supabase, reportDate);
    const statusRows = buildStatusRows(dealers, hootPack.rows, reportDate);
    const missing = statusRows.filter((r) => !r.transmitted);
    const unitsToday = statusRows.reduce((s, r) => s + r.transferred_units, 0);
    const template = formatReport(
      statusRows,
      reportDate,
      hootPack.hootSource,
      hootPack.hootAsOf,
    );

    console.log(
      `[hoot-dealers-daily-status] dealers=${statusRows.length} hootRows=${hootPack.rows.length} via ${hootPack.hootSource}`,
    );
    console.log(`\n${template}\n`);

    await supabase.from("smart_hoot_daily_status").upsert(
      statusRows.map((r) => ({
        report_date: r.report_date,
        ga4_customer_id: r.ga4_customer_id,
        dealer_name: r.dealer_name,
        transmitted: r.transmitted,
        live_units: r.live_units,
        transferred_units: r.transferred_units,
        first_seen_today: r.first_seen_today,
        last_seen: r.last_seen,
        checked_at: new Date().toISOString(),
      })),
      { onConflict: "report_date,ga4_customer_id" },
    );

    const csv = statusCsv(statusRows);
    const csvBytes = new TextEncoder().encode(csv);
    const filename = `hoot-dealers-daily-status-${reportDate}.csv`;

    const html = buildHtmlEmail({
      reportDate,
      rows: statusRows,
      hootAsOf: hootPack.hootAsOf,
      hootSource: hootPack.hootSource,
      filename,
    });
    const text = template;

    const { user: smtpMailbox } = resolvedSmtpAuth();
    const fromName = cfg?.from_name || "Hoot Dealers Status";
    const from =
      Deno.env.get("INVENTORY_EMAIL_FROM")?.trim() ||
      cfg?.from_email ||
      (smtpMailbox
        ? `${fromName} <${smtpMailbox}>`
        : `${fromName} <noreply@localhost>`);

    const subjectPrefix = cfg?.subject_prefix || "Hoot Dealers Daily Status";
    const subject = `${subjectPrefix} · ${reportDate} · ${statusRows.length - missing.length}/${statusRows.length} transmitted`;

    if (dryRun) {
      if (logId) {
        await supabase
          .from("smart_inventory_email_log")
          .update({
            finished_at: new Date().toISOString(),
            ok: true,
            recipients,
            hoot_rows: hootPack.rows.length,
            total_rows: unitsToday,
            dealer_count: statusRows.length,
            csv_bytes: csvBytes.byteLength,
            meta: {
              kind: EMAIL_KIND,
              dryRun: true,
              from,
              hootSource: hootPack.hootSource,
              hootAsOf: hootPack.hootAsOf,
              missing: missing.length,
            },
          })
          .eq("id", logId);
      }
      return jsonRes({
        email_sent: false,
        ok: true,
        dryRun: true,
        reportDate,
        dealer_count: statusRows.length,
        transmitted_count: statusRows.length - missing.length,
        missing_count: missing.length,
        units_today: unitsToday,
        recipients,
        cc,
        from,
        hootSource: hootPack.hootSource,
        hootAsOf: hootPack.hootAsOf,
        missing_dealers: missing.map((r) => ({
          dealer_name: r.dealer_name,
          ga4_customer_id: r.ga4_customer_id,
        })),
        dealers: statusRows,
        template,
      });
    }

    console.log("[hoot-dealers-daily-status] sending SMTP …", {
      reportDate,
      to: recipients,
      cc,
      from,
      hootAsOf: hootPack.hootAsOf,
    });

    const sent = await sendViaSmtp({
      from,
      to: recipients,
      cc,
      subject,
      html,
      text,
      attachments: [
        {
          filename,
          content: csvBytes,
          contentType: "text/csv",
        },
      ],
    });

    console.log("[hoot-dealers-daily-status] EMAIL SENT OK", {
      smtp_message_id: sent.messageId ?? null,
      to: recipients,
    });

    if (logId) {
      await supabase
        .from("smart_inventory_email_log")
        .update({
          finished_at: new Date().toISOString(),
          ok: true,
          recipients,
          hoot_rows: hootPack.rows.length,
          total_rows: unitsToday,
          dealer_count: statusRows.length,
          csv_bytes: csvBytes.byteLength,
          provider_id: sent.messageId ?? null,
          meta: {
            kind: EMAIL_KIND,
            hootSource: hootPack.hootSource,
            hootAsOf: hootPack.hootAsOf,
            missing: missing.length,
            transport: "google_smtp",
          },
        })
        .eq("id", logId);
    }

    return jsonRes({
      email_sent: true,
      ok: true,
      reportDate,
      dealer_count: statusRows.length,
      transmitted_count: statusRows.length - missing.length,
      missing_count: missing.length,
      units_today: unitsToday,
      recipients,
      cc,
      smtp_message_id: sent.messageId ?? null,
      hootSource: hootPack.hootSource,
      hootAsOf: hootPack.hootAsOf,
      missing_dealers: missing.map((r) => ({
        dealer_name: r.dealer_name,
        ga4_customer_id: r.ga4_customer_id,
      })),
      dealers: statusRows,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[hoot-dealers-daily-status] EMAIL NOT SENT —", message);
    if (logId) {
      await supabase
        .from("smart_inventory_email_log")
        .update({
          finished_at: new Date().toISOString(),
          ok: false,
          error: message,
        })
        .eq("id", logId);
    }
    return jsonRes({ email_sent: false, ok: false, error: message }, 500);
  }
});
