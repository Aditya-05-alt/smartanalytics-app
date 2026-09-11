-- Add Compare to Admin > Roles report catalog and grant to all role=user accounts.
INSERT INTO public.smart_reports (report_key, label, href, sort_order) VALUES
  ('compare', 'Compare', '/dashboard/compare', 2)
ON CONFLICT (report_key) DO UPDATE SET
  label = EXCLUDED.label,
  href = EXCLUDED.href,
  sort_order = EXCLUDED.sort_order;

UPDATE public.smart_reports SET sort_order = 3 WHERE report_key = 'campaigns';
UPDATE public.smart_reports SET sort_order = 4 WHERE report_key = 'inventory';
UPDATE public.smart_reports SET sort_order = 5 WHERE report_key = 'health';
UPDATE public.smart_reports SET sort_order = 6 WHERE report_key = 'attribution';
UPDATE public.smart_reports SET sort_order = 7 WHERE report_key = 'local';
UPDATE public.smart_reports SET sort_order = 8 WHERE report_key = 'ads';

INSERT INTO public.smart_user_reports (auth_user_id, report_key)
SELECT r.auth_user_id, 'compare'
FROM public.smart_user_roles r
WHERE r.role_key = 'user'
  AND COALESCE(r.all_reports, false) IS NOT TRUE
  AND NOT EXISTS (
    SELECT 1
    FROM public.smart_user_reports ur
    WHERE ur.auth_user_id = r.auth_user_id
      AND ur.report_key = 'compare'
  );
