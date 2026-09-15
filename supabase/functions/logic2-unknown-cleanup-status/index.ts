import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import nodemailer from "npm:nodemailer@6.9.16";

/**
 * Daily summary after logic2-unknown-cleanup.
 * Emails exception counts per dealer to aditya@brandmirchi.com.
 */

const SMTP_USER = "devops@brandmirchi.com";
const SMTP_PASS = "";
const DEFAULT_TO = ["aditya@brandmirchi.com"];
const SMTP_HOST = "smtp.gmail.com";
const SMTP_PORT = 587;
const SMTP_SECURE = false;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type ExceptionRow = {
  customer_id: string;
  dealer_name: string | null;
  cms: string | null;
  exception_urls: number;
  total_views: number;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
  subject: string;
  html: string;
  text: string;
}): Promise<{ messageId?: string }> {
  const { user, pass } = resolvedSmtpAuth();
  if (!user || !pass) {
    throw new Error(
      "Missing SMTP credentials: set SMTP_USER + SMTP_PASS Edge secrets.",
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
    subject: params.subject,
    html: params.html,
    text: params.text,
  });

  return { messageId: info.messageId };
}

function buildHtml(opts: {
  reportDate: string;
  daysBack: number;
  dealersProcessed: number;
  dealersWithExceptions: number;
  totalExceptionUrls: number;
  rows: ExceptionRow[];
}): string {
  const tableRows = opts.rows.length
    ? opts.rows
      .map(
        (r) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">${escapeHtml(r.dealer_name || r.customer_id)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-family:monospace;font-size:12px;">${escapeHtml(r.customer_id)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">${escapeHtml(r.cms || "—")}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:600;">${r.exception_urls}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right;">${r.total_views}</td>
      </tr>`,
      )
      .join("")
    : `<tr><td colspan="5" style="padding:16px;color:#64748b;">No exception URLs remaining.</td></tr>`;

  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Segoe UI,Arial,sans-serif;color:#0f172a;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px;">
    <tr><td align="center">
      <table width="720" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
        <tr>
          <td style="padding:24px 28px;background:#0f172a;color:#fff;">
            <div style="font-size:13px;opacity:.75;letter-spacing:.04em;">SMART ANALYTICS</div>
            <div style="font-size:22px;font-weight:700;margin-top:6px;">Unknown / Other filtration complete</div>
            <div style="font-size:13px;margin-top:8px;opacity:.85;">Report date ${escapeHtml(opts.reportDate)} · last ${opts.daysBack} days</div>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 28px;">
            <p style="margin:0 0 16px;font-size:15px;line-height:1.5;">
              All dealers have been filtered for Unknown/Other using VDP Logic 2.
              Leftover URLs are stored in <code>smart_exception_data</code>.
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
              <tr>
                <td style="padding:12px 14px;background:#f8fafc;border-radius:8px;width:33%;">
                  <div style="font-size:12px;color:#64748b;">Dealers processed</div>
                  <div style="font-size:22px;font-weight:700;">${opts.dealersProcessed}</div>
                </td>
                <td style="width:12px;"></td>
                <td style="padding:12px 14px;background:#fff7ed;border-radius:8px;width:33%;">
                  <div style="font-size:12px;color:#9a3412;">Dealers with exceptions</div>
                  <div style="font-size:22px;font-weight:700;color:#c2410c;">${opts.dealersWithExceptions}</div>
                </td>
                <td style="width:12px;"></td>
                <td style="padding:12px 14px;background:#fef2f2;border-radius:8px;width:33%;">
                  <div style="font-size:12px;color:#991b1b;">Total exception URLs</div>
                  <div style="font-size:22px;font-weight:700;color:#b91c1c;">${opts.totalExceptionUrls}</div>
                </td>
              </tr>
            </table>
            <div style="font-size:14px;font-weight:600;margin-bottom:8px;">Exception count by dealer</div>
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;font-size:13px;">
              <thead>
                <tr style="background:#f8fafc;text-align:left;">
                  <th style="padding:8px 12px;">Dealer</th>
                  <th style="padding:8px 12px;">Customer ID</th>
                  <th style="padding:8px 12px;">CMS</th>
                  <th style="padding:8px 12px;text-align:right;">Exceptions</th>
                  <th style="padding:8px 12px;text-align:right;">Views</th>
                </tr>
              </thead>
              <tbody>${tableRows}</tbody>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 28px;border-top:1px solid #e2e8f0;background:#f8fafc;font-size:12px;color:#94a3b8;">
            Automated daily email · Logic2 Unknown cleanup · Smart Analytics
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    /* empty */
  }

  const dryRun = Boolean(body?.dry_run);
  const daysBack = body?.days_back != null
    ? Math.max(1, Number(body.days_back) || 7)
    : 7;
  const recipients = Array.isArray(body?.to) && body.to.length
    ? (body.to as string[]).map(String)
    : DEFAULT_TO;
  const filterClientIds = Array.isArray(body?.client_ids)
    ? (body.client_ids as unknown[]).map((v) => String(v).trim()).filter(Boolean)
    : [];
  const isTest = Boolean(body?.test) || filterClientIds.length > 0;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const reportDate = new Date().toISOString().slice(0, 10);

  try {
    const { data: activeDealers, error: dErr } = await supabase
      .from("smart_ga4_config")
      .select("client_id")
      .eq("is_active", true);
    if (dErr) throw dErr;

    const dealersProcessed = filterClientIds.length > 0
      ? filterClientIds.length
      : (activeDealers || []).length;

    let rows: ExceptionRow[] = [];
    const { data: exceptionAgg, error: eErr } = await supabase.rpc(
      "get_logic2_exception_summary",
    );
    if (eErr) {
      // Fallback if RPC not deployed yet — aggregate in edge
      const { data: raw, error: rErr } = await supabase
        .from("smart_exception_data")
        .select("customer_id, dealer_name, cms, views");
      if (rErr) throw rErr;

      const map = new Map<string, ExceptionRow>();
      for (const row of raw || []) {
        const id = String(row.customer_id);
        if (filterClientIds.length && !filterClientIds.includes(id)) continue;
        const cur = map.get(id) || {
          customer_id: id,
          dealer_name: row.dealer_name,
          cms: row.cms,
          exception_urls: 0,
          total_views: 0,
        };
        cur.exception_urls += 1;
        cur.total_views += Number(row.views) || 0;
        if (!cur.dealer_name && row.dealer_name) cur.dealer_name = row.dealer_name;
        if (!cur.cms && row.cms) cur.cms = row.cms;
        map.set(id, cur);
      }
      rows = [...map.values()].sort((a, b) =>
        b.exception_urls - a.exception_urls ||
        String(a.dealer_name || "").localeCompare(String(b.dealer_name || ""))
      );
    } else {
      rows = ((exceptionAgg || []) as Record<string, unknown>[])
        .map((r) => ({
          customer_id: String(r.customer_id),
          dealer_name: r.dealer_name != null ? String(r.dealer_name) : null,
          cms: r.cms != null ? String(r.cms) : null,
          exception_urls: Number(r.exception_urls) || 0,
          total_views: Number(r.total_views) || 0,
        }))
        .filter((r) =>
          filterClientIds.length === 0 || filterClientIds.includes(r.customer_id)
        );
    }

    // Include requested dealers with 0 exceptions so the test email is complete
    if (filterClientIds.length) {
      const present = new Set(rows.map((r) => r.customer_id));
      for (const id of filterClientIds) {
        if (present.has(id)) continue;
        const { data: nameRow } = await supabase
          .from("smart_ga4_config")
          .select("account_name")
          .eq("client_id", id)
          .maybeSingle();
        rows.push({
          customer_id: id,
          dealer_name: nameRow?.account_name ? String(nameRow.account_name) : id,
          cms: null,
          exception_urls: 0,
          total_views: 0,
        });
      }
      rows.sort((a, b) =>
        String(a.dealer_name || "").localeCompare(String(b.dealer_name || ""))
      );
    }

    const dealersWithExceptions = rows.filter((r) => r.exception_urls > 0).length;
    const totalExceptionUrls = rows.reduce((s, r) => s + r.exception_urls, 0);

    const subject =
      `${isTest ? "[TEST] " : ""}Unknown filtration done · ${dealersWithExceptions} dealers with exceptions · ${reportDate}`;

    const text = [
      `Smart Analytics — Unknown/Other filtration complete${isTest ? " (TEST RUN)" : ""}`,
      `Report date: ${reportDate}`,
      `Window: last ${daysBack} days`,
      `Dealers processed: ${dealersProcessed}`,
      `Dealers with exceptions: ${dealersWithExceptions}`,
      `Total exception URLs: ${totalExceptionUrls}`,
      "",
      "Exception count by dealer:",
      ...rows.map(
        (r) =>
          `${r.dealer_name || r.customer_id} (${r.customer_id}) · CMS ${r.cms || "—"} · ${r.exception_urls} URLs · ${r.total_views} views`,
      ),
    ].join("\n");

    const html = buildHtml({
      reportDate,
      daysBack,
      dealersProcessed,
      dealersWithExceptions,
      totalExceptionUrls,
      rows,
    });

    const from = `Smart Analytics <${resolvedSmtpAuth().user || SMTP_USER}>`;

    if (dryRun) {
      return new Response(
        JSON.stringify({
          email_sent: false,
          dryRun: true,
          reportDate,
          days_back: daysBack,
          dealers_processed: dealersProcessed,
          dealers_with_exceptions: dealersWithExceptions,
          total_exception_urls: totalExceptionUrls,
          recipients,
          subject,
          rows,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const sent = await sendViaSmtp({
      from,
      to: recipients,
      subject,
      html,
      text,
    });

    console.log("[logic2-unknown-cleanup-status] EMAIL SENT OK", {
      messageId: sent.messageId,
      dealersWithExceptions,
      totalExceptionUrls,
    });

    return new Response(
      JSON.stringify({
        email_sent: true,
        ok: true,
        reportDate,
        days_back: daysBack,
        dealers_processed: dealersProcessed,
        dealers_with_exceptions: dealersWithExceptions,
        total_exception_urls: totalExceptionUrls,
        recipients,
        subject,
        messageId: sent.messageId,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[logic2-unknown-cleanup-status] EMAIL NOT SENT —", message);
    return new Response(
      JSON.stringify({ email_sent: false, ok: false, error: message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      },
    );
  }
});
