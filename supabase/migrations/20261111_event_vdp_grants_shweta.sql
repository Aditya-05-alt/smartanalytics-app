-- Event Tracking and VDP Analysis (explicit reports) also for shweta@brandmirchi.com,
-- alongside avi@wheeleradvertising.com and aditya@brandmirchi.com.

INSERT INTO public.smart_user_reports (auth_user_id, report_key)
SELECT ur.auth_user_id, k.report_key
FROM public.smart_user_roles ur
CROSS JOIN (VALUES ('event-tracking'), ('vdp-analysis')) AS k(report_key)
WHERE lower(ur.email) = 'shweta@brandmirchi.com'
ON CONFLICT DO NOTHING;
