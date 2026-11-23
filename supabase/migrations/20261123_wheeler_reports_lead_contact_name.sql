-- Store lead contact name for report drill-down (email/phone still not stored).
alter table public.wheeler_reports_leads
  add column if not exists contact_name text not null default '';
