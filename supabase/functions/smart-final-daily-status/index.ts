/**
 * Daily Smart Analytics pipeline status email (Google SMTP / nodemailer).
 *
 * Reports whether Steps 1–3 ran smoothly for the rolling window, plus
 * per-dealer smart_final_data coverage.
 *
 * From name / subject: "Smart Analytics Data Update"
 * Cron: 10:30 AM IST = 05:00 UTC (retry 10:45 AM IST = 05:15 UTC)
 *
 * Manual: POST {} | {"dry_run":true} | {"to":["you@company.com"]}
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.9.16";

const REPORT_TIMEZONE = "Asia/Kolkata";
const DEFAULT_DAYS_BACK = 7;
const BRAND_FROM_NAME = "Smart Analytics Data Update";
const BRAND_SUBJECT = "Smart Analytics Data Update";

const SMTP_USER = "devops@brandmirchi.com";
const SMTP_PASS = "";
const DEFAULT_EMAIL_TO = ["adity@brandmirchi.com", "lisa@brandmirchi.com"];
const DEFAULT_EMAIL_CC = ["aditya@brandmirchi.com"];

const SMTP_HOST = "smtp.gmail.com";
const SMTP_PORT = 587;
const SMTP_SECURE = false;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const EMAIL_KIND = "smart_analytics_data_update";

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

type PipelineDay = {
  report_date: string;
  ga4_dealers: number;
  ga4_rows: number;
  vdp_dealers: number;
  vdp_rows: number;
  final_dealers: number;
  final_rows: number;
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

function pad(
  value: string | number,
  width: number,
  align: "left" | "right" = "left",
) {
  const s = String(value ?? "");
  if (s.length >= width) return s.slice(0, width);
  const space = " ".repeat(width - s.length);
  return align === "right" ? space + s : s + space;
}

function pipelineVerdict(days: PipelineDay[], activeDealers: number) {
  // Ignore "today" for smoothness — GA4 often still settling.
  const settled = days.filter((d) => d.report_date < todayIst());
  if (!settled.length) {
    return {
      ok: true,
      label: "ON TRACK",
      detail: "No prior-day window yet — check again after Step 3.",
    };
  }

  const weak = settled.filter(
    (d) =>
      d.ga4_dealers < Math.floor(activeDealers * 0.7) ||
      d.vdp_dealers < Math.floor(activeDealers * 0.5) ||
      d.final_dealers < Math.floor(activeDealers * 0.5),
  );

  if (!weak.length) {
    return {
      ok: true,
      label: "SMOOTH",
      detail: "Steps 1–3 look healthy for the recent window (excl. today).",
    };
  }

  return {
    ok: false,
    label: "NEEDS ATTENTION",
    detail: `Coverage thin on: ${weak.map((d) => d.report_date).join(", ")}`,
  };
}

function formatReport(
  rows: StatusRow[],
  reportDate: string,
  daysBack: number,
  pipeline: PipelineDay[],
  activeDealers: number,
) {
  const total = rows.length;
  const yes = rows.filter((r) => r.transmitted).length;
  const no = total - yes;
  const rebuilt = rows.filter((r) => r.rebuilt_today).length;
  const totalRows = rows.reduce((s, r) => s + r.total_rows, 0);
  const matched = rows.reduce((s, r) => s + r.matched_rows, 0);
  const verdict = pipelineVerdict(pipeline, activeDealers);

  const lines = [
    "============================================================",
    "SMART ANALYTICS DATA UPDATE",
    `Report date : ${reportDate} (Asia/Kolkata)`,
    `Window      : last ${daysBack} report_date day(s)`,
    `Pipeline    : ${verdict.label} — ${verdict.detail}`,
    `Dealers     : ${total}  |  With final data: ${yes}  |  Missing: ${no}`,
    `Rebuilt today (created_at IST): ${rebuilt}`,
    `Final rows / matched : ${totalRows.toLocaleString("en-IN")} / ${matched.toLocaleString("en-IN")}`,
    "============================================================",
    "PIPELINE BY DAY (Step 1 GA4 · Step 2 VDP · Step 3 Final)",
    `${pad("Date", 12)}  ${pad("GA4 dlrs", 9, "right")}  ${pad("VDP dlrs", 9, "right")}  ${pad("Final dlrs", 10, "right")}  ${pad("Final rows", 11, "right")}`,
    "------------------------------------------------------------",
  ];

  for (const d of pipeline) {
    lines.push(
      `${pad(d.report_date, 12)}  ${pad(d.ga4_dealers, 9, "right")}  ${pad(d.vdp_dealers, 9, "right")}  ${pad(d.final_dealers, 10, "right")}  ${pad(d.final_rows, 11, "right")}`,
    );
  }

  lines.push("------------------------------------------------------------");
  lines.push(
    `${pad("#", 3)}  ${pad("Status", 6)}  ${pad("Today", 6)}  ${pad("Dealer", 34)}  ${pad("Rows", 8, "right")}  ${pad("Match", 8, "right")}`,
  );
  lines.push("------------------------------------------------------------");

  rows.forEach((row, i) => {
    lines.push(
      `${pad(i + 1, 3, "right")}  ${pad(row.transmitted ? "YES" : "NO", 6)}  ${pad(row.rebuilt_today ? "YES" : "NO", 6)}  ${pad(row.dealer_name || "-", 34)}  ${pad(row.total_rows, 8, "right")}  ${pad(row.matched_rows, 8, "right")}`,
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
  pipeline: PipelineDay[];
  activeDealers: number;
}) {
  const { reportDate, rows, daysBack, filename, pipeline, activeDealers } =
    opts;
  const displayDate = formatDisplayDate(reportDate);
  const yes = rows.filter((r) => r.transmitted);
  const no = rows.filter((r) => !r.transmitted);
  const rebuilt = rows.filter((r) => r.rebuilt_today);
  const totalRows = rows.reduce((s, r) => s + r.total_rows, 0);
  const matched = rows.reduce((s, r) => s + r.matched_rows, 0);
  const verdict = pipelineVerdict(pipeline, activeDealers);

  const pipelineHtml = pipeline
    .map(
      (d) =>
        `<tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#0f172a;">${escapeHtml(d.report_date)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;text-align:right;font-variant-numeric:tabular-nums;">${d.ga4_dealers}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;text-align:right;font-variant-numeric:tabular-nums;">${d.vdp_dealers}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;text-align:right;font-variant-numeric:tabular-nums;">${d.final_dealers}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;text-align:right;font-variant-numeric:tabular-nums;">${d.final_rows.toLocaleString("en-IN")}</td>
        </tr>`,
    )
    .join("");

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
  <title>${escapeHtml(BRAND_SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:720px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
          <tr>
            <td style="padding:28px 28px 20px;background:#0f172a;">
              <p style="margin:0 0 6px;font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:#a3e635;">Daily Pipeline</p>
              <h1 style="margin:0;font-size:24px;line-height:1.25;font-weight:700;color:#ffffff;">${escapeHtml(BRAND_SUBJECT)}</h1>
              <p style="margin:10px 0 0;font-size:14px;line-height:1.5;color:#cbd5e1;">Steps 1–3 health · last ${daysBack} days · ${escapeHtml(displayDate)}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 28px;">
              <div style="margin:0 0 18px;padding:14px 16px;border-radius:10px;border:1px solid ${
                verdict.ok ? "#bbf7d0" : "#fecaca"
              };background:${verdict.ok ? "#f0fdf4" : "#fef2f2"};">
                <p style="margin:0 0 4px;font-size:12px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:${
                  verdict.ok ? "#15803d" : "#b91c1c"
                };">Pipeline ${escapeHtml(verdict.label)}</p>
                <p style="margin:0;font-size:14px;color:#334155;">${escapeHtml(verdict.detail)}</p>
              </div>

              <p style="margin:0 0 18px;font-size:14px;line-height:1.55;color:#334155;">
                Daily check after GA4 sync (Step 1), VDP filtration (Step 2), and final rebuild (Step 3).
                Dealer table below is <strong>smart_final_data</strong> coverage for the rolling window.
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
                      <p style="margin:0 0 4px;font-size:12px;color:#64748b;">With final data</p>
                      <p style="margin:0;font-size:20px;font-weight:700;color:#1d4ed8;">${yes.length.toLocaleString("en-IN")}</p>
                    </div>
                  </td>
                  <td width="50%" style="padding:0 0 0 6px;vertical-align:top;">
                    <div style="border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;background:#fef2f2;">
                      <p style="margin:0 0 4px;font-size:12px;color:#64748b;">Missing final</p>
                      <p style="margin:0;font-size:20px;font-weight:700;color:#b91c1c;">${no.length.toLocaleString("en-IN")}</p>
                    </div>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 16px;font-size:13px;color:#475569;">
                Rebuilt today: <strong style="color:#0f172a;">${rebuilt.length.toLocaleString("en-IN")}</strong> dealer(s)
              </p>

              <h2 style="margin:0 0 10px;font-size:15px;font-weight:600;color:#0f172a;">Pipeline by day</h2>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;margin:0 0 22px;">
                <tr style="background:#f8fafc;">
                  <th align="left" style="padding:8px 12px;font-size:12px;font-weight:600;color:#64748b;">Date</th>
                  <th align="right" style="padding:8px 12px;font-size:12px;font-weight:600;color:#64748b;">Step 1 dealers</th>
                  <th align="right" style="padding:8px 12px;font-size:12px;font-weight:600;color:#64748b;">Step 2 VDP</th>
                  <th align="right" style="padding:8px 12px;font-size:12px;font-weight:600;color:#64748b;">Step 3 dealers</th>
                  <th align="right" style="padding:8px 12px;font-size:12px;font-weight:600;color:#64748b;">Final rows</th>
                </tr>
                ${pipelineHtml || `<tr><td colspan="5" style="padding:12px;font-size:13px;color:#64748b;">No pipeline rows</td></tr>`}
              </table>

              <h2 style="margin:0 0 10px;font-size:15px;font-weight:600;color:#0f172a;">All dealers (Step 3)</h2>
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

              <p style="margin:0;font-size:12px;color:#94a3b8;">CSV attached: ${escapeHtml(filename)}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px 24px;border-top:1px solid #e2e8f0;background:#f8fafc;">
              <p style="margin:0;font-size:12px;line-height:1.5;color:#94a3b8;">
                Automated daily email · ${escapeHtml(BRAND_SUBJECT)} · Smart Analytics
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
      "Missing SMTP credentials: set SMTP_USER + SMTP_PASS Edge secrets (Google App Password).",
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

async function loadPipelineDays(
  supabase: ReturnType<typeof createClient>,
  daysBack: number,
): Promise<{ activeDealers: number; days: PipelineDay[] }> {
  const { data, error } = await supabase.rpc("get_smart_pipeline_daily_status", {
    p_days_back: daysBack,
  });
  if (error) {
    throw new Error(
      `${error.message} — deploy supabase/rpc/get_smart_pipeline_daily_status.sql`,
    );
  }

  const rows = (data || []) as Record<string, unknown>[];
  const activeDealers = Number(rows[0]?.active_dealers) || 0;
  const days: PipelineDay[] = rows.map((r) => ({
    report_date: String(r.report_date).slice(0, 10),
    ga4_dealers: Number(r.ga4_dealers) || 0,
    ga4_rows: Number(r.ga4_rows) || 0,
    vdp_dealers: Number(r.vdp_dealers) || 0,
    vdp_rows: Number(r.vdp_rows) || 0,
    final_dealers: Number(r.final_dealers) || 0,
    final_rows: Number(r.final_rows) || 0,
  }));

  return { activeDealers, days };
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
    body?.days_back != null
      ? Math.max(1, Number(body.days_back))
      : DEFAULT_DAYS_BACK;
  const reportDate =
    typeof body?.report_date === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(body.report_date.slice(0, 10))
      ? String(body.report_date).slice(0, 10)
      : todayIst();

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) {
    return jsonRes(
      {
        email_sent: false,
        ok: false,
        error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
      },
      500,
    );
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  let logId: number | null = null;

  try {
    const { data: logInsert, error: logErr } = await supabase
      .from("smart_inventory_email_log")
      .insert({
        started_at: new Date().toISOString(),
        ok: false,
        meta: { kind: EMAIL_KIND },
      })
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
        .limit(40);
      if (
        prior?.some(
          (row) =>
            row?.meta?.kind === EMAIL_KIND ||
            row?.meta?.kind === "smart_final_daily_status",
        )
      ) {
        return jsonRes({
          email_sent: false,
          ok: true,
          skipped: true,
          message: "Already sent Smart Analytics Data Update successfully today",
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

    const secretTo = parseEmailList(
      Deno.env.get("INVENTORY_EMAIL_TO")?.trim() || "",
    );
    const inlineTo = parseEmailList(DEFAULT_EMAIL_TO);
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
        : dbTo.length > 0
        ? dbTo
        : inlineTo;

    if (!recipients.length) {
      return jsonRes({
        email_sent: false,
        ok: false,
        skipped: true,
        reason:
          "Set recipients in smart_inventory_email_config, Edge secret INVENTORY_EMAIL_TO, or body.to",
        reportDate,
      });
    }

    const secretCc = parseEmailList(
      Deno.env.get("INVENTORY_EMAIL_CC")?.trim() || "",
    );
    const inlineCc = parseEmailList(DEFAULT_EMAIL_CC);
    const dbCc = Array.isArray(cfg?.cc_recipients)
      ? cfg.cc_recipients
          .map((x: string) => String(x).trim())
          .filter((e: string) => !isPlaceholderEmail(e))
      : [];
    const cc =
      secretCc.length > 0 ? secretCc : dbCc.length > 0 ? dbCc : inlineCc;

    console.log(
      `[smart-final-daily-status] Loading status for ${reportDate} (days_back=${daysBack})…`,
    );

    const [{ data: statusData, error: statusErr }, pipeline] =
      await Promise.all([
        supabase.rpc("get_smart_final_daily_status", {
          p_days_back: daysBack,
        }),
        loadPipelineDays(supabase, Math.min(daysBack, 5)),
      ]);

    if (statusErr) {
      throw new Error(
        `${statusErr.message} — deploy supabase/rpc/get_smart_final_daily_status.sql`,
      );
    }

    const statusRows: StatusRow[] = (
      (statusData || []) as Record<string, unknown>[]
    ).map((r) => {
      const total = Number(r.total_rows) || 0;
      return {
        report_date: reportDate,
        client_id: String(r.client_id ?? "").trim(),
        dealer_name: String(r.account_name ?? r.client_id ?? "-").trim(),
        cms: String(r.cms ?? "-"),
        transmitted: total > 0,
        rebuilt_today: r.rebuilt_today === true,
        total_rows: total,
        matched_rows: Number(r.matched_rows) || 0,
        min_report_date: r.min_report_date ? String(r.min_report_date) : null,
        max_report_date: r.max_report_date ? String(r.max_report_date) : null,
      };
    });

    const missing = statusRows.filter((r) => !r.transmitted);
    const totalRows = statusRows.reduce((s, r) => s + r.total_rows, 0);
    const verdict = pipelineVerdict(pipeline.days, pipeline.activeDealers);
    const template = formatReport(
      statusRows,
      reportDate,
      daysBack,
      pipeline.days,
      pipeline.activeDealers,
    );

    console.log(
      `[smart-final-daily-status] dealers=${statusRows.length} with_data=${
        statusRows.length - missing.length
      } missing=${missing.length} pipeline=${verdict.label}`,
    );
    console.log(`\n${template}\n`);

    const csv = statusCsv(statusRows);
    const csvBytes = new TextEncoder().encode(csv);
    const filename = `smart-analytics-data-update-${reportDate}.csv`;

    const html = buildHtmlEmail({
      reportDate,
      rows: statusRows,
      daysBack,
      filename,
      pipeline: pipeline.days,
      activeDealers: pipeline.activeDealers,
    });

    const { user: smtpMailbox } = resolvedSmtpAuth();
    // Always brand as Smart Analytics Data Update (never Inventory Analysis).
    const from =
      Deno.env.get("INVENTORY_EMAIL_FROM")?.trim() ||
      (smtpMailbox
        ? `${BRAND_FROM_NAME} <${smtpMailbox}>`
        : `${BRAND_FROM_NAME} <noreply@localhost>`);

    const subject =
      `${BRAND_SUBJECT} · ${reportDate} · ${verdict.label} · ${
        statusRows.length - missing.length
      }/${statusRows.length} dealers with data`;

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
              pipeline: verdict.label,
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
        pipeline: verdict,
        recipients,
        cc,
        from,
        subject,
        missing_dealers: missing.map((r) => ({
          dealer_name: r.dealer_name,
          client_id: r.client_id,
        })),
      });
    }

    console.log("[smart-final-daily-status] sending SMTP …", {
      reportDate,
      to: recipients,
      cc,
      from,
      subject,
    });

    const sent = await sendViaSmtp({
      from,
      to: recipients,
      cc,
      subject,
      html,
      text: template,
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
            pipeline: verdict.label,
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
      pipeline: verdict,
      recipients,
      cc,
      from,
      subject,
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
