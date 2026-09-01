/**
 * Daily smart_final_data (Step 3) status email via Google SMTP (nodemailer).
 *
 * Lists every active GA4 dealer and whether smart_final_data has rows for the
 * rolling Step 3 window (default last 7 report_dates), with matched counts
 * and whether rows were rebuilt today (created_at IST).
 *
 * Google SMTP: set SMTP_USER / SMTP_PASS below, OR Edge secrets with the same names
 * (secrets win when in-file pass is empty — safe for deploy).
 * Recipients: INVENTORY_EMAIL_TO below; secret / DB config / body.to can override.
 *
 * Cron: 10:00 AM IST = 04:30 UTC (after Hoot/QS/Scrap Step 3).
 *
 * Manual test: POST {} or POST {"dry_run":true} or POST {"to":["you@company.com"]}
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.9.16";

const REPORT_TIMEZONE = "Asia/Kolkata";
const DEFAULT_DAYS_BACK = 7;

/** Google Workspace / Gmail SMTP — prefer Edge secrets SMTP_USER / SMTP_PASS. */
const SMTP_USER = "devops@brandmirchi.com";
const SMTP_PASS = "";
const INVENTORY_EMAIL_TO = [
  "lisa@brandmirchi.com",
];
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

const EMAIL_KIND = "smart_final_daily_status";

type StatusRow = {
  report_date: string;
  client_id: string;
  dealer_name: string;
  cms: string;
  transmitted: boolean;
  rebuilt_today: boolean;
  total_rows: number;
  matched_rows: number;
  min_report_date: string | null;
  max_report_date: string | null;
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

function pad(value: string | number, width: number, align: "left" | "right" = "left") {
  const s = String(value ?? "");
  if (s.length >= width) return s.slice(0, width);
  const space = " ".repeat(width - s.length);
  return align === "right" ? space + s : s + space;
}

function formatReport(rows: StatusRow[], reportDate: string, daysBack: number) {
  const total = rows.length;
  const yes = rows.filter((r) => r.transmitted).length;
  const no = total - yes;
  const rebuilt = rows.filter((r) => r.rebuilt_today).length;
  const totalRows = rows.reduce((s, r) => s + r.total_rows, 0);
  const matched = rows.reduce((s, r) => s + r.matched_rows, 0);

  const lines = [
    "============================================================",
    "SMART FINAL DATA DAILY STATUS (Step 3)",
    `Report date : ${reportDate} (Asia/Kolkata)`,
    `Window      : last ${daysBack} report_date day(s)`,
    `Dealers     : ${total}  |  With data: ${yes}  |  Missing: ${no}`,
    `Rebuilt today (created_at IST): ${rebuilt}`,
    `Rows / matched : ${totalRows.toLocaleString("en-IN")} / ${matched.toLocaleString("en-IN")}`,
    "============================================================",
    `${pad("#", 3)}  ${pad("Status", 6)}  ${pad("Today", 6)}  ${pad("Dealer", 34)}  ${pad("Rows", 8, "right")}  ${pad("Match", 8, "right")}`,
    "------------------------------------------------------------",
  ];

  rows.forEach((row, i) => {
    lines.push(
      `${pad(i + 1, 3, "right")}  ${pad(row.transmitted ? "YES" : "NO", 6)}  ${pad(row.rebuilt_today ? "YES" : "NO", 6)}  ${pad(row.dealer_name || "—", 34)}  ${pad(row.total_rows, 8, "right")}  ${pad(row.matched_rows, 8, "right")}`,
    );
  });

  const missing = rows.filter((r) => !r.transmitted);
  lines.push("------------------------------------------------------------");
  if (missing.length) {
    lines.push("MISSING (no smart_final_data in window):");
    for (const row of missing) {
      lines.push(`  - ${row.dealer_name}  (${row.client_id})`);
    }
  } else {
    lines.push("All active dealers have smart_final_data in the window.");
  }
  lines.push("============================================================");
  return lines.join("\n");
}

function statusCsv(rows: StatusRow[]) {
  const headers = [
    "Status",
    "Rebuilt Today",
    "Dealer Name",
    "Client ID",
    "CMS",
    "Total Rows",
    "Matched Rows",
    "Min Report Date",
    "Max Report Date",
    "Report Date",
  ];
  const lines = rows.map((r) =>
    [
      r.transmitted ? "YES" : "NO",
      r.rebuilt_today ? "YES" : "NO",
      r.dealer_name,
      r.client_id,
      r.cms,
      r.total_rows,
      r.matched_rows,
      r.min_report_date ?? "",
      r.max_report_date ?? "",
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
  daysBack: number;
  filename: string;
}) {
  const { reportDate, rows, daysBack, filename } = opts;
  const displayDate = formatDisplayDate(reportDate);
  const yes = rows.filter((r) => r.transmitted);
  const no = rows.filter((r) => !r.transmitted);
  const rebuilt = rows.filter((r) => r.rebuilt_today);
  const totalRows = rows.reduce((s, r) => s + r.total_rows, 0);
  const matched = rows.reduce((s, r) => s + r.matched_rows, 0);

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
          <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;text-align:center;">
            <span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;${
              r.rebuilt_today
                ? "background:#dbeafe;color:#1d4ed8;"
                : "background:#f1f5f9;color:#64748b;"
            }">${r.rebuilt_today ? "YES" : "NO"}</span>
          </td>
          <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#0f172a;text-align:right;font-variant-numeric:tabular-nums;">${r.total_rows.toLocaleString("en-IN")}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#0f172a;text-align:right;font-variant-numeric:tabular-nums;">${r.matched_rows.toLocaleString("en-IN")}</td>
        </tr>`,
    )
    .join("");

  const missingHtml = no.length
    ? no
        .map(
          (r) =>
            `<li style="margin:0 0 4px;font-size:13px;color:#b91c1c;">${escapeHtml(r.dealer_name)} <span style="color:#94a3b8;">(${escapeHtml(r.client_id)})</span></li>`,
        )
        .join("")
    : `<li style="font-size:13px;color:#15803d;">All active dealers have smart_final_data in the window.</li>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Smart Final Data Daily Status</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:720px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
          <tr>
            <td style="padding:28px 28px 20px;background:#0f172a;">
              <p style="margin:0 0 6px;font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:#93c5fd;">Step 3 · Pipeline</p>
              <h1 style="margin:0;font-size:24px;line-height:1.25;font-weight:700;color:#ffffff;">Smart Final Data Daily Status</h1>
              <p style="margin:10px 0 0;font-size:14px;line-height:1.5;color:#cbd5e1;">All active dealers · last ${daysBack} days · ${escapeHtml(displayDate)}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 28px;">
              <p style="margin:0 0 18px;font-size:14px;line-height:1.55;color:#334155;">
                Daily check after Step 3 (Hoot / QS / Scrap).
                Counts rows in <strong>smart_final_data</strong> for the rolling report window
                and whether any rows were <strong>rebuilt today</strong> (created_at IST).
              </p>

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 20px;">
                <tr>
                  <td width="50%" style="padding:0 6px 12px 0;vertical-align:top;">
                    <div style="border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;background:#f8fafc;">
                      <p style="margin:0 0 4px;font-size:12px;color:#64748b;">Active dealers</p>
                      <p style="margin:0;font-size:22px;font-weight:700;color:#0f172a;">${rows.length.toLocaleString("en-IN")}</p>
                    </div>
                  </td>
                  <td width="50%" style="padding:0 0 12px 6px;vertical-align:top;">
                    <div style="border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;background:#f8fafc;">
                      <p style="margin:0 0 4px;font-size:12px;color:#64748b;">Final rows / matched</p>
                      <p style="margin:0;font-size:22px;font-weight:700;color:#0f172a;">${totalRows.toLocaleString("en-IN")} <span style="font-size:14px;font-weight:600;color:#64748b;">/ ${matched.toLocaleString("en-IN")}</span></p>
                    </div>
                  </td>
                </tr>
                <tr>
                  <td width="50%" style="padding:0 6px 0 0;vertical-align:top;">
                    <div style="border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;background:#eff6ff;">
                      <p style="margin:0 0 4px;font-size:12px;color:#64748b;">With data</p>
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

              <p style="margin:0 0 16px;font-size:13px;color:#475569;">
                Rebuilt today: <strong style="color:#0f172a;">${rebuilt.length.toLocaleString("en-IN")}</strong> dealer(s)
              </p>

              <h2 style="margin:0 0 10px;font-size:15px;font-weight:600;color:#0f172a;">All dealers</h2>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;margin:0 0 22px;">
                <tr style="background:#f8fafc;">
                  <th align="left" style="padding:8px 12px;font-size:12px;font-weight:600;color:#64748b;">Dealer</th>
                  <th align="center" style="padding:8px 12px;font-size:12px;font-weight:600;color:#64748b;">Data</th>
                  <th align="center" style="padding:8px 12px;font-size:12px;font-weight:600;color:#64748b;">Today</th>
                  <th align="right" style="padding:8px 12px;font-size:12px;font-weight:600;color:#64748b;">Rows</th>
                  <th align="right" style="padding:8px 12px;font-size:12px;font-weight:600;color:#64748b;">Matched</th>
                </tr>
                ${dealerHtml || `<tr><td colspan="5" style="padding:12px;font-size:13px;color:#64748b;">No active dealers</td></tr>`}
              </table>

              <h2 style="margin:0 0 8px;font-size:15px;font-weight:600;color:#0f172a;">Missing in window</h2>
              <ul style="margin:0 0 18px;padding:0 0 0 18px;">${missingHtml}</ul>

              <p style="margin:0;font-size:12px;color:#94a3b8;">Source: get_smart_final_daily_status · CSV attached: ${escapeHtml(filename)}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px 24px;border-top:1px solid #e2e8f0;background:#f8fafc;">
              <p style="margin:0;font-size:12px;line-height:1.5;color:#94a3b8;">
                Automated daily email from Smart Final Data Status · Smart Analytics
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
  const daysBack =
    body?.days_back != null ? Math.max(1, Number(body.days_back)) : DEFAULT_DAYS_BACK;
  const reportDate =
    typeof body?.report_date === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(body.report_date.slice(0, 10))
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
        .limit(30);
      if (prior?.some((row) => row?.meta?.kind === EMAIL_KIND)) {
        return jsonRes({
          email_sent: false,
          ok: true,
          skipped: true,
          message: "Already sent smart final daily status successfully today",
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
      ? cfg.recipients
          .map((x: string) => String(x).trim())
          .filter((e: string) => !isPlaceholderEmail(e))
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
      ? cfg.cc_recipients
          .map((x: string) => String(x).trim())
          .filter((e: string) => !isPlaceholderEmail(e))
      : [];
    const cc =
      secretCc.length > 0 ? secretCc : inlineCc.length > 0 ? inlineCc : dbCc;

    console.log(
      `[smart-final-daily-status] Loading final data status for ${reportDate} (days_back=${daysBack})…`,
    );

    const { data: statusData, error: statusErr } = await supabase.rpc(
      "get_smart_final_daily_status",
      { p_days_back: daysBack },
    );
    if (statusErr) {
      throw new Error(
        `${statusErr.message} — deploy supabase/rpc/get_smart_final_daily_status.sql`,
      );
    }

    const statusRows: StatusRow[] = ((statusData || []) as Record<string, unknown>[]).map(
      (r) => {
        const total = Number(r.total_rows) || 0;
        return {
          report_date: reportDate,
          client_id: String(r.client_id ?? "").trim(),
          dealer_name: String(r.account_name ?? r.client_id ?? "—").trim(),
          cms: String(r.cms ?? "—"),
          transmitted: total > 0,
          rebuilt_today: r.rebuilt_today === true,
          total_rows: total,
          matched_rows: Number(r.matched_rows) || 0,
          min_report_date: r.min_report_date ? String(r.min_report_date) : null,
          max_report_date: r.max_report_date ? String(r.max_report_date) : null,
        };
      },
    );

    const missing = statusRows.filter((r) => !r.transmitted);
    const totalRows = statusRows.reduce((s, r) => s + r.total_rows, 0);
    const template = formatReport(statusRows, reportDate, daysBack);

    console.log(
      `[smart-final-daily-status] dealers=${statusRows.length} with_data=${statusRows.length - missing.length} missing=${missing.length}`,
    );
    console.log(`\n${template}\n`);

    const csv = statusCsv(statusRows);
    const csvBytes = new TextEncoder().encode(csv);
    const filename = `smart-final-daily-status-${reportDate}.csv`;

    const html = buildHtmlEmail({
      reportDate,
      rows: statusRows,
      daysBack,
      filename,
    });
    const text = template;

    const { user: smtpMailbox } = resolvedSmtpAuth();
    const fromName = cfg?.from_name || "Smart Final Data Status";
    const from =
      Deno.env.get("INVENTORY_EMAIL_FROM")?.trim() ||
      cfg?.from_email ||
      (smtpMailbox
        ? `${fromName} <${smtpMailbox}>`
        : `${fromName} <noreply@localhost>`);

    const subjectPrefix = cfg?.subject_prefix || "Smart Final Data Daily Status";
    const subject = `${subjectPrefix} · ${reportDate} · ${statusRows.length - missing.length}/${statusRows.length} with data`;

    if (dryRun) {
      if (logId) {
        await supabase
          .from("smart_inventory_email_log")
          .update({
            finished_at: new Date().toISOString(),
            ok: true,
            recipients,
            total_rows: totalRows,
            dealer_count: statusRows.length,
            csv_bytes: csvBytes.byteLength,
            meta: {
              kind: EMAIL_KIND,
              dryRun: true,
              from,
              daysBack,
              missing: missing.length,
              rebuilt_today: statusRows.filter((r) => r.rebuilt_today).length,
            },
          })
          .eq("id", logId);
      }
      return jsonRes({
        email_sent: false,
        ok: true,
        dryRun: true,
        reportDate,
        days_back: daysBack,
        dealer_count: statusRows.length,
        with_data_count: statusRows.length - missing.length,
        missing_count: missing.length,
        total_rows: totalRows,
        recipients,
        cc,
        from,
        missing_dealers: missing.map((r) => ({
          dealer_name: r.dealer_name,
          client_id: r.client_id,
        })),
        dealers: statusRows,
        template,
      });
    }

    console.log("[smart-final-daily-status] sending SMTP …", {
      reportDate,
      to: recipients,
      cc,
      from,
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
          contentType: "text/csv; charset=utf-8",
        },
      ],
    });

    if (logId) {
      await supabase
        .from("smart_inventory_email_log")
        .update({
          finished_at: new Date().toISOString(),
          ok: true,
          recipients,
          total_rows: totalRows,
          dealer_count: statusRows.length,
          csv_bytes: csvBytes.byteLength,
          provider_id: sent.messageId ?? null,
          meta: {
            kind: EMAIL_KIND,
            from,
            daysBack,
            missing: missing.length,
            rebuilt_today: statusRows.filter((r) => r.rebuilt_today).length,
            subject,
          },
        })
        .eq("id", logId);
    }

    return jsonRes({
      email_sent: true,
      ok: true,
      reportDate,
      days_back: daysBack,
      dealer_count: statusRows.length,
      with_data_count: statusRows.length - missing.length,
      missing_count: missing.length,
      total_rows: totalRows,
      recipients,
      cc,
      from,
      messageId: sent.messageId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[smart-final-daily-status] error:", message);
    if (logId) {
      await supabase
        .from("smart_inventory_email_log")
        .update({
          finished_at: new Date().toISOString(),
          ok: false,
          error: message,
          meta: { kind: EMAIL_KIND },
        })
        .eq("id", logId);
    }
    return jsonRes({ email_sent: false, ok: false, error: message }, 500);
  }
});
