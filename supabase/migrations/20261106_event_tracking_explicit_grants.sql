-- Event Tracking is an explicit report (EXPLICIT_REPORT_KEYS in permissions.js):
-- only avi@wheeleradvertising.com and aditya@brandmirchi.com.

INSERT INTO public.smart_reports (report_key, label, href, sort_order)
VALUES ('event-tracking', 'Event Tracking', '/dashboard/event-tracking', 7)
ON CONFLICT (report_key) DO UPDATE SET
  label = EXCLUDED.label,
  href = EXCLUDED.href,
  sort_order = EXCLUDED.sort_order;

INSERT INTO public.smart_user_reports (auth_user_id, report_key)
SELECT ur.auth_user_id, 'event-tracking'
FROM public.smart_user_roles ur
WHERE lower(ur.email) IN ('avi@wheeleradvertising.com', 'aditya@brandmirchi.com')
ON CONFLICT DO NOTHING;

DELETE FROM public.smart_user_reports r
USING public.smart_user_roles ur
WHERE r.auth_user_id = ur.auth_user_id
  AND r.report_key = 'event-tracking'
  AND lower(ur.email) NOT IN ('avi@wheeleradvertising.com', 'aditya@brandmirchi.com');
