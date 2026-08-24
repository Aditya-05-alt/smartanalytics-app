-- Add Campaigns to Admin > Roles report catalog.
INSERT INTO public.smart_reports (report_key, label, href, sort_order) VALUES
  ('campaigns', 'Campaigns', '/dashboard/campaigns', 2)
ON CONFLICT (report_key) DO UPDATE SET
  label = EXCLUDED.label,
  href = EXCLUDED.href,
  sort_order = EXCLUDED.sort_order;

-- Keep sort order aligned with sidebar (campaigns after overview).
UPDATE public.smart_reports SET sort_order = 3 WHERE report_key = 'inventory';
UPDATE public.smart_reports SET sort_order = 4 WHERE report_key = 'health';
UPDATE public.smart_reports SET sort_order = 5 WHERE report_key = 'attribution';
UPDATE public.smart_reports SET sort_order = 6 WHERE report_key = 'local';
