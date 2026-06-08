-- Recommended indexes for Channel / Campaign breakdown speed (run in Supabase SQL editor).
-- Safe to run multiple times (IF NOT EXISTS).

CREATE INDEX IF NOT EXISTS idx_ga4_page_client_date
  ON public.smart_ga4_page_data (client_id, report_date);

CREATE INDEX IF NOT EXISTS idx_ga4_page_client_date_path
  ON public.smart_ga4_page_data (client_id, report_date, page_path);

CREATE INDEX IF NOT EXISTS idx_final_data_client_date_path
  ON public.smart_final_data (client_id, report_date, page_path);

CREATE INDEX IF NOT EXISTS idx_final_data_client_date_make
  ON public.smart_final_data (client_id, report_date, inv_make);

CREATE INDEX IF NOT EXISTS idx_final_data_client_date_year
  ON public.smart_final_data (client_id, report_date, inv_year);
