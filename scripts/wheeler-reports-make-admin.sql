-- Make yourself a Wheeler Reports admin (after you have a login in Supabase Auth).
-- 1) Ensure a profile row exists (the migration backfills existing users).
-- 2) Run this with your email:
update public.wheeler_reports_profiles
set role = 'admin', client_id = null
where email = 'you@wheeleradvertising.com';

-- 3) Also grant the dashboard report key in Smart Analytics user access
--    (Admin → Roles, or insert 'wheeler-reports' into report_keys).
