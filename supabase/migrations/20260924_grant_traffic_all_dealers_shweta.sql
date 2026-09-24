-- Grant Traffic + All Dealers to shweta@brandmirchi.com (same as Aditya for these two).
-- Keep avi@wheeleradvertising.com on traffic only.

INSERT INTO public.smart_user_reports (auth_user_id, report_key)
SELECT ur.auth_user_id, v.report_key
FROM public.smart_user_roles ur
CROSS JOIN (VALUES ('traffic'), ('all-dealers')) AS v(report_key)
WHERE lower(ur.email) = 'shweta@brandmirchi.com'
ON CONFLICT DO NOTHING;

-- all-dealers allowlist: Aditya + Shweta only
DELETE FROM public.smart_user_reports r
USING public.smart_user_roles ur
WHERE r.auth_user_id = ur.auth_user_id
  AND r.report_key = 'all-dealers'
  AND lower(ur.email) NOT IN (
    'aditya@brandmirchi.com',
    'shweta@brandmirchi.com'
  );
