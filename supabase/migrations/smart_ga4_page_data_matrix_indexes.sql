-- Speed up all-dealer channel matrix chunked queries.
CREATE INDEX IF NOT EXISTS idx_smart_ga4_page_data_date_client
  ON public.smart_ga4_page_data (report_date, client_id);

CREATE INDEX IF NOT EXISTS idx_smart_ga4_page_data_client_date
  ON public.smart_ga4_page_data (client_id, report_date);

-- Helps VDP / channel matrix aggregates (client + date + channel).
CREATE INDEX IF NOT EXISTS idx_ga4_page_data_client_date_channel
  ON public.smart_ga4_page_data (client_id, report_date, channel);

CREATE INDEX IF NOT EXISTS idx_ga4_page_data_client_date_pagetype
  ON public.smart_ga4_page_data (client_id, report_date, ga4_page_type);

ANALYZE public.smart_ga4_page_data;
