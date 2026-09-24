-- Explicit report grants (production, 2026-09-23)
-- all-dealers: aditya@brandmirchi.com + shweta@brandmirchi.com
-- traffic: aditya@brandmirchi.com + avi@wheeleradvertising.com + shweta@brandmirchi.com
--
-- App: EXPLICIT_REPORT_KEYS = traffic, all-dealers in permissions.js

INSERT INTO public.smart_reports (report_key, label, href, sort_order)
VALUES ('all-dealers', 'All Dealers', '/dashboard/all-dealers', 2)
ON CONFLICT (report_key) DO UPDATE SET
  label = EXCLUDED.label,
  href = EXCLUDED.href,
  sort_order = EXCLUDED.sort_order;

INSERT INTO public.smart_user_reports (auth_user_id, report_key)
SELECT ur.auth_user_id, v.report_key
FROM public.smart_user_roles ur
CROSS JOIN (VALUES ('traffic'), ('all-dealers')) AS v(report_key)
WHERE lower(ur.email) IN (
  'aditya@brandmirchi.com',
  'shweta@brandmirchi.com'
)
ON CONFLICT DO NOTHING;

INSERT INTO public.smart_user_reports (auth_user_id, report_key)
SELECT ur.auth_user_id, 'traffic'
FROM public.smart_user_roles ur
WHERE lower(ur.email) = 'avi@wheeleradvertising.com'
ON CONFLICT DO NOTHING;

DELETE FROM public.smart_user_reports r
USING public.smart_user_roles ur
WHERE r.auth_user_id = ur.auth_user_id
  AND r.report_key = 'all-dealers'
  AND lower(ur.email) NOT IN (
    'aditya@brandmirchi.com',
    'shweta@brandmirchi.com'
  );
