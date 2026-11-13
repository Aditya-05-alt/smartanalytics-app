import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import nodemailer from "npm:nodemailer@6.9.16";

/**
 * Morning email of Event Tracking leads (counted GA4 form events) per dealer.
 * Runs after the nightly smart-ga4-events sync. The report day is the last complete one
 * (two days back in UTC): US dealers' "yesterday" is still running when the sync fires.
 * Sends once per report day (smart_event_leads_report_log) to the fixed recipient list and
 * returns no lead data. Body: optional report_date (YYYY-MM-DD, within the last 14 days).
 */

const SMTP_USER = "devops@brandmirchi.com";
const RECIPIENTS = ["aditya@brandmirchi.com"];
const SMTP_HOST = "smtp.gmail.com";
const SMTP_PORT = 587;
const MAX_BACK_DAYS = 14;

type Row = {
  client_id: string;
  dealer_name: string | null;
  has_forms: boolean;
  day_leads: number;
  prev_day: number;
  last7: number;
  mtd: number;
  forms: { form: string; n: number }[];
};

const fmt = (n: number) => Number(n || 0).toLocaleString("en-US");
const isoDaysAgo = (n: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};
const dayLabel = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  });
const formLabel = (type: string) => type.replace(/_submit$/, "").replace(/_/g, " ");

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function change(cur: number, prev: number) {
  const diff = cur - prev;
  const color = diff > 0 ? "#15803d" : diff < 0 ? "#b91c1c" : "#64748b";
  const sign = diff > 0 ? "+" : "";
  const pct = prev > 0 ? ` (${sign}${Math.round((100 * diff) / prev)}%)` : "";
  return { text: `${sign}${fmt(diff)}${pct}`, color };
}

function buildHtml(reportDate: string, rows: Row[]): string {
  const tracked = rows.filter((r) => r.has_forms || r.day_leads > 0 || r.mtd > 0);
  const untracked = rows.filter((r) => !tracked.includes(r));
  const sum = (k: keyof Row) => tracked.reduce((s, r) => s + Number(r[k] || 0), 0);
  const day = sum("day_leads");
  const prev = sum("prev_day");
  const withLeads = tracked.filter((r) => r.day_leads > 0).length;
  const dayChange = change(day, prev);

  const card = (label: string, value: string, sub: string, bg: string, color: string) => `
    <td style="padding:12px 14px;background:${bg};border-radius:8px;width:25%;vertical-align:top;">
      <div style="font-size:12px;color:#64748b;">${label}</div>
      <div style="font-size:22px;font-weight:700;color:${color};">${value}</div>
      <div style="font-size:11px;color:#64748b;margin-top:2px;">${sub}</div>
    </td>`;

  const cell = "padding:8px 10px;border-bottom:1px solid #e2e8f0;";
  const body = tracked.map((r) => {
    const c = change(Number(r.day_leads), Number(r.prev_day));
    const forms = (r.forms || []).map((f) => `${escapeHtml(formLabel(f.form))} <b>${fmt(f.n)}</b>`).join(" · ") || "—";
    return `
      <tr>
        <td style="${cell}font-weight:600;">${escapeHtml(r.dealer_name || r.client_id)}</td>
        <td style="${cell}text-align:right;font-weight:700;">${fmt(r.day_leads)}</td>
        <td style="${cell}text-align:right;">${fmt(r.prev_day)}</td>
        <td style="${cell}text-align:right;color:${c.color};">${c.text}</td>
        <td style="${cell}text-align:right;">${fmt(r.last7)}</td>
        <td style="${cell}text-align:right;">${fmt(r.mtd)}</td>
        <td style="${cell}font-size:12px;color:#334155;">${forms}</td>
      </tr>`;
  }).join("");

  const untrackedNote = untracked.length
    ? `<p style="margin:16px 0 0;font-size:12px;color:#64748b;line-height:1.5;">
        <b>No form tracking in GA4 (${untracked.length}):</b>
        ${untracked.map((r) => escapeHtml(r.dealer_name || r.client_id)).join(", ")}
      </p>`
    : "";

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f1f5f9;font-family:Segoe UI,Arial,sans-serif;color:#0f172a;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px;"><tr><td align="center">
<table width="960" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
  <tr><td style="padding:24px 28px;background:#0f172a;color:#fff;">
    <div style="font-size:13px;opacity:.75;letter-spacing:.04em;">SMART ANALYTICS · EVENT TRACKING</div>
    <div style="font-size:22px;font-weight:700;margin-top:6px;">Daily leads by dealer — ${escapeHtml(dayLabel(reportDate))}</div>
    <div style="font-size:13px;margin-top:8px;opacity:.85;">${tracked.length} dealers with form tracking · leads = GA4 form submissions</div>
  </td></tr>
  <tr><td style="padding:24px 28px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;"><tr>
      ${card("Leads", fmt(day), `<span style="color:${dayChange.color};">${dayChange.text}</span> vs day before`, "#f8fafc", "#0f172a")}<td style="width:10px;"></td>
      ${card("Dealers with leads", `${withLeads} / ${tracked.length}`, "on the day", "#f0fdf4", "#15803d")}<td style="width:10px;"></td>
      ${card("Last 7 days", fmt(sum("last7")), "including the day", "#eff6ff", "#1d4ed8")}<td style="width:10px;"></td>
      ${card("Month to date", fmt(sum("mtd")), `1st to ${escapeHtml(dayLabel(reportDate))}`, "#fff7ed", "#c2410c")}
    </tr></table>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;font-size:13px;">
      <thead><tr style="background:#f8fafc;text-align:left;">
        <th style="padding:8px 10px;">Dealer</th>
        <th style="padding:8px 10px;text-align:right;">Leads</th>
        <th style="padding:8px 10px;text-align:right;">Day before</th>
        <th style="padding:8px 10px;text-align:right;">Change</th>
        <th style="padding:8px 10px;text-align:right;">Last 7 days</th>
        <th style="padding:8px 10px;text-align:right;">Month to date</th>
        <th style="padding:8px 10px;">Forms on the day</th>
      </tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr style="background:#f8fafc;font-weight:700;">
        <td style="padding:8px 10px;">All dealers</td>
        <td style="padding:8px 10px;text-align:right;">${fmt(day)}</td>
        <td style="padding:8px 10px;text-align:right;">${fmt(prev)}</td>
        <td style="padding:8px 10px;text-align:right;color:${dayChange.color};">${dayChange.text}</td>
        <td style="padding:8px 10px;text-align:right;">${fmt(sum("last7"))}</td>
        <td style="padding:8px 10px;text-align:right;">${fmt(sum("mtd"))}</td>
        <td style="padding:8px 10px;"></td>
      </tr></tfoot>
    </table>
    ${untrackedNote}
  </td></tr>
  <tr><td style="padding:16px 28px;border-top:1px solid #e2e8f0;background:#f8fafc;font-size:12px;color:#94a3b8;">
    Automated report after the nightly Event Tracking sync · each dealer's leads are its own registered forms only · Smart Analytics
  </td></tr>
</table></td></tr></table></body></html>`;
}

serve(async (req) => {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    /* empty */
  }
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

  const reportDate = String(body?.report_date || isoDaysAgo(2)).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate) || reportDate > isoDaysAgo(1) || reportDate < isoDaysAgo(MAX_BACK_DAYS)) {
    return json({ ok: false, error: `report_date must be within the last ${MAX_BACK_DAYS} days` }, 400);
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let claimed = false;
  try {
    // Claim the day first so overlapping calls never send twice.
    const { data: claim, error: claimErr } = await supabase
      .from("smart_event_leads_report_log")
      .upsert({ report_date: reportDate }, { onConflict: "report_date", ignoreDuplicates: true })
      .select("report_date");
    if (claimErr) throw claimErr;
    if (!claim?.length) return json({ ok: true, email_sent: false, reason: "already sent", report_date: reportDate });
    claimed = true;

    // Register the night's new dealer forms and rebuild the daily totals before reading them.
    const { error: refreshErr } = await supabase.rpc("refresh_event_tracking_events_mv");
    if (refreshErr) throw refreshErr;

    const { data, error } = await supabase.rpc("get_event_leads_daily_report", { p_date: reportDate });
    if (error) throw error;
    const rows = (data || []) as Row[];
    const tracked = rows.filter((r) => r.has_forms || Number(r.day_leads) > 0 || Number(r.mtd) > 0);
    const leads = tracked.reduce((s, r) => s + Number(r.day_leads || 0), 0);
    const withLeads = tracked.filter((r) => Number(r.day_leads) > 0).length;

    const subject = `Daily leads ${dayLabel(reportDate)}: ${fmt(leads)} leads across ${withLeads} dealers`;
    const text = [
      `Event Tracking — daily leads by dealer, ${dayLabel(reportDate)}`,
      `Leads: ${fmt(leads)} (day before ${fmt(tracked.reduce((s, r) => s + Number(r.prev_day || 0), 0))})`,
      "",
      ...tracked.map((r) =>
        `${r.dealer_name || r.client_id}: ${fmt(r.day_leads)} (day before ${fmt(r.prev_day)}, 7 days ${fmt(r.last7)}, MTD ${fmt(r.mtd)})` +
        `${(r.forms || []).length ? ` · ${r.forms.map((f) => `${formLabel(f.form)} ${f.n}`).join(", ")}` : ""}`
      ),
    ].join("\n");

    const user = Deno.env.get("SMTP_USER")?.trim() || SMTP_USER;
    const pass = (Deno.env.get("SMTP_PASS") ?? "").replace(/\s+/g, "").trim();
    if (!pass) throw new Error("Missing SMTP_PASS Edge secret");

    const transporter = nodemailer.createTransport({ host: SMTP_HOST, port: SMTP_PORT, secure: false, auth: { user, pass } });
    await transporter.sendMail({
      from: `Smart Analytics <${user}>`,
      to: RECIPIENTS.join(", "),
      subject,
      html: buildHtml(reportDate, rows),
      text,
    });

    await supabase
      .from("smart_event_leads_report_log")
      .update({ sent_at: new Date().toISOString(), recipients: RECIPIENTS, dealers: tracked.length, leads })
      .eq("report_date", reportDate);
    return json({ ok: true, email_sent: true, report_date: reportDate });
  } catch (err) {
    const message = err instanceof Error ? err.message : (err as { message?: string })?.message || String(err);
    console.error("[event-leads-daily-report]", message);
    if (claimed) await supabase.from("smart_event_leads_report_log").delete().eq("report_date", reportDate).is("sent_at", null);
    return json({ ok: false, email_sent: false, error: message }, 500);
  }
});
