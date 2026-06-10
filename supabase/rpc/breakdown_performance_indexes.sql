-- Indexes for Channel / Campaign breakdown speed (run in Supabase SQL editor).
-- Safe to run multiple times (IF NOT EXISTS).

-- smart_ga4_page_data (most critical)
CREATE INDEX IF NOT EXISTS idx_ga4_page_data_client_date_pagetype
  ON public.smart_ga4_page_data (client_id, report_date, ga4_page_type);

CREATE INDEX IF NOT EXISTS idx_ga4_page_data_client_date_channel
  ON public.smart_ga4_page_data (client_id, report_date, channel);

CREATE INDEX IF NOT EXISTS idx_ga4_page_data_join
  ON public.smart_ga4_page_data (client_id, report_date, page_path);

-- smart_final_data (inventory join)
CREATE INDEX IF NOT EXISTS idx_final_data_join
  ON public.smart_final_data (client_id, report_date, page_path);

CREATE INDEX IF NOT EXISTS idx_final_data_filters
  ON public.smart_final_data (client_id, report_date)
  INCLUDE (inv_type, inv_make, inv_model, inv_location, inv_year, inv_condition);

ANALYZE public.smart_ga4_page_data;
ANALYZE public.smart_final_data;
