-- Catalog: All Dealers external report (sidebar clone of Overview All Dealers).
INSERT INTO public.smart_reports (report_key, label, href, sort_order)
VALUES ('all-dealers', 'All Dealers', '/dashboard/all-dealers', 2)
ON CONFLICT (report_key) DO UPDATE SET
  label = EXCLUDED.label,
  href = EXCLUDED.href,
  sort_order = EXCLUDED.sort_order;
