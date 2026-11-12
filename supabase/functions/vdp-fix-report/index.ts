import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import nodemailer from "npm:nodemailer@6.9.16";

/**
 * Emails the outcome of a one-off VDP unmapped-URL fix (smart_vdp_fix_log).
 * Takes no input beyond run_label, always mails the fixed recipient list, and
 * sends once per run (smart_vdp_fix_runs.email_sent_at).
 */

const SMTP_USER = "devops@brandmirchi.com";
const RECIPIENTS = ["aditya@brandmirchi.com"];
const SMTP_HOST = "smtp.gmail.com";
const SMTP_PORT = 587;

type LogRow = {
  client_id: string;
  dealer_name: string | null;
  before_paths: number | null;
  before_views: number | null;
  total_views: number | null;
  after_paths: number | null;
  after_views: number | null;
  actions: string[] | null;
  notes: string | null;
};

const fmt = (n: number) => Number(n || 0).toLocaleString("en-US");
const pct = (part: number, whole: number) =>
  whole > 0 ? `${((100 * part) / whole).toFixed(1)}%` : "0%";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildHtml(title: string, period: string, rows: LogRow[]): string {
  const before = rows.reduce((s, r) => s + Number(r.before_views || 0), 0);
  const after = rows.reduce((s, r) => s + Number(r.after_views || 0), 0);
  const clean = rows.filter((r) => Number(r.after_views || 0) === 0).length;
  const under1 = rows.filter((r) => Number(r.after_views || 0) <= 0.01 * Number(r.total_views || 0)).length;

  const card = (label: string, value: string, bg: string, color: string) => `
    <td style="padding:12px 14px;background:${bg};border-radius:8px;width:25%;">
      <div style="font-size:12px;color:#64748b;">${label}</div>
      <div style="font-size:22px;font-weight:700;color:${color};">${value}</div>
    </td>`;

  const body = rows.map((r) => {
    const b = Number(r.before_views || 0);
    const a = Number(r.after_views || 0);
    const t = Number(r.total_views || 0);
    const ok = a <= 0.01 * t;
    const status = a === 0 ? "Clean" : ok ? "Fixed" : "Partly fixed";
    const statusColor = a === 0 || ok ? "#15803d" : "#c2410c";
    const actions = (r.actions || []).map((x) => escapeHtml(x)).join("<br>") || "—";
    const notes = r.notes ? `<div style="margin-top:4px;color:#64748b;">${escapeHtml(r.notes)}</div>` : "";
    return `
      <tr>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-weight:600;">${escapeHtml(r.dealer_name || r.client_id)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:right;">${fmt(b)}<div style="color:#94a3b8;font-size:11px;">${fmt(Number(r.before_paths || 0))} URLs</div></td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:right;">${fmt(a)}<div style="color:#94a3b8;font-size:11px;">${fmt(Number(r.after_paths || 0))} URLs</div></td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:right;">${pct(a, t)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;color:${statusColor};font-weight:600;">${status}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:12px;">${actions}${notes}</td>
      </tr>`;
  }).join("");

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f1f5f9;font-family:Segoe UI,Arial,sans-serif;color:#0f172a;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px;"><tr><td align="center">
<table width="900" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
  <tr><td style="padding:24px 28px;background:#0f172a;color:#fff;">
    <div style="font-size:13px;opacity:.75;letter-spacing:.04em;">SMART ANALYTICS</div>
    <div style="font-size:22px;font-weight:700;margin-top:6px;">${escapeHtml(title)} — complete</div>
    <div style="font-size:13px;margin-top:8px;opacity:.85;">${escapeHtml(period)} · ${rows.length} dealers</div>
  </td></tr>
  <tr><td style="padding:24px 28px;">
    <p style="margin:0 0 16px;font-size:15px;line-height:1.5;">
      All dealers with unmapped VDP URLs were fixed one by one. Unmapped views dropped from
      <b>${fmt(before)}</b> to <b>${fmt(after)}</b> (${pct(before - after, before)} fixed).
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;"><tr>
      ${card("Dealers fixed", String(rows.length), "#f8fafc", "#0f172a")}<td style="width:10px;"></td>
      ${card("Fully clean", String(clean), "#f0fdf4", "#15803d")}<td style="width:10px;"></td>
      ${card("Under 1% unmapped", String(under1), "#eff6ff", "#1d4ed8")}<td style="width:10px;"></td>
      ${card("Unmapped views left", fmt(after), "#fff7ed", "#c2410c")}
    </tr></table>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;font-size:13px;">
      <thead><tr style="background:#f8fafc;text-align:left;">
        <th style="padding:8px 10px;">Dealer</th>
        <th style="padding:8px 10px;text-align:right;">Unmapped before</th>
        <th style="padding:8px 10px;text-align:right;">Unmapped after</th>
        <th style="padding:8px 10px;text-align:right;">% of views</th>
        <th style="padding:8px 10px;">Status</th>
        <th style="padding:8px 10px;">What was done</th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table>
  </td></tr>
  <tr><td style="padding:16px 28px;border-top:1px solid #e2e8f0;background:#f8fafc;font-size:12px;color:#94a3b8;">
    Automated report · VDP unmapped URL fix · Smart Analytics
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
  const runLabel = String(body?.run_label || "oct-2026").trim();
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

  try {
    const { data: run, error: runErr } = await supabase
      .from("smart_vdp_fix_runs")
      .select("run_label, title, period_from, period_to, email_sent_at")
      .eq("run_label", runLabel)
      .maybeSingle();
    if (runErr) throw runErr;
    if (!run) return json({ ok: false, error: "unknown run" }, 404);
    if (run.email_sent_at) return json({ ok: true, email_sent: false, reason: "already sent", sent_at: run.email_sent_at });

    const { data: rows, error } = await supabase
      .from("smart_vdp_fix_log")
      .select("client_id, dealer_name, before_paths, before_views, total_views, after_paths, after_views, actions, notes")
      .eq("run_label", runLabel)
      .order("before_views", { ascending: false });
    if (error) throw error;

    const list = (rows || []) as LogRow[];
    const before = list.reduce((s, r) => s + Number(r.before_views || 0), 0);
    const after = list.reduce((s, r) => s + Number(r.after_views || 0), 0);
    const period = `${run.period_from} to ${run.period_to}`;
    const subject = `${run.title}: ${list.length} dealers fixed · unmapped views ${fmt(before)} → ${fmt(after)}`;
    const text = [
      `${run.title} — complete (${period})`,
      `Unmapped views: ${fmt(before)} → ${fmt(after)}`,
      "",
      ...list.map((r) =>
        `${r.dealer_name || r.client_id}: ${fmt(Number(r.before_views || 0))} → ${fmt(Number(r.after_views || 0))} unmapped views` +
        `${(r.actions || []).length ? ` · ${(r.actions || []).join("; ")}` : ""}${r.notes ? ` · ${r.notes}` : ""}`
      ),
    ].join("\n");

    const user = Deno.env.get("SMTP_USER")?.trim() || SMTP_USER;
    const pass = (Deno.env.get("SMTP_PASS") ?? "").replace(/\s+/g, "").trim();
    if (!pass) throw new Error("Missing SMTP_PASS Edge secret");

    const transporter = nodemailer.createTransport({ host: SMTP_HOST, port: SMTP_PORT, secure: false, auth: { user, pass } });
    const info = await transporter.sendMail({
      from: `Smart Analytics <${user}>`,
      to: RECIPIENTS.join(", "),
      subject,
      html: buildHtml(run.title, period, list),
      text,
    });

    await supabase.from("smart_vdp_fix_runs").update({ email_sent_at: new Date().toISOString() }).eq("run_label", runLabel);
    return json({ ok: true, email_sent: true, recipients: RECIPIENTS, subject, messageId: info.messageId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[vdp-fix-report]", message);
    return json({ ok: false, email_sent: false, error: message }, 500);
  }
});
