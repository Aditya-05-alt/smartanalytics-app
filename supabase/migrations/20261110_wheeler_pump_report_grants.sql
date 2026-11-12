-- Wheeler Pump In / Pump Out module in SmartAnalytics (/dashboard/wheeler-pump).
-- Sidebar/page access: explicit report (EXPLICIT_REPORT_KEYS in permissions.js),
--   only avi@wheeleradvertising.com and aditya@brandmirchi.com.
-- Data access is still Wheeler Pump's own row-level security (wheeler_pump_memberships),
--   so both are also Wheeler admins there.

INSERT INTO public.smart_reports (report_key, label, href, sort_order)
VALUES ('wheeler-pump', 'Wheeler Pump', '/dashboard/wheeler-pump', 9)
ON CONFLICT (report_key) DO UPDATE SET
  label = EXCLUDED.label,
  href = EXCLUDED.href,
  sort_order = EXCLUDED.sort_order;

INSERT INTO public.smart_user_reports (auth_user_id, report_key)
SELECT ur.auth_user_id, 'wheeler-pump'
FROM public.smart_user_roles ur
WHERE lower(ur.email) IN ('avi@wheeleradvertising.com', 'aditya@brandmirchi.com')
ON CONFLICT DO NOTHING;

DELETE FROM public.smart_user_reports r
USING public.smart_user_roles ur
WHERE r.auth_user_id = ur.auth_user_id
  AND r.report_key = 'wheeler-pump'
  AND lower(ur.email) NOT IN ('avi@wheeleradvertising.com', 'aditya@brandmirchi.com');

-- Logins created before Wheeler Pump was installed have no profile yet (wheeler_pump_handle_new_user).
INSERT INTO public.wheeler_pump_profiles (id, email, full_name)
SELECT u.id, u.email, coalesce(u.raw_user_meta_data->>'full_name', '')
FROM auth.users u
WHERE lower(u.email) IN ('avi@wheeleradvertising.com', 'aditya@brandmirchi.com')
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

INSERT INTO public.wheeler_pump_memberships (user_id, role)
SELECT u.id, 'wheeler_admin'
FROM auth.users u
WHERE lower(u.email) IN ('avi@wheeleradvertising.com', 'aditya@brandmirchi.com')
  AND NOT EXISTS (
    SELECT 1 FROM public.wheeler_pump_memberships m
    WHERE m.user_id = u.id AND m.role = 'wheeler_admin'
  );
