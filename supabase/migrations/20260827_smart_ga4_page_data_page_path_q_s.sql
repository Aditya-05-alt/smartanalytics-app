-- page_path_q_s: pathname + query string from GA4 pageLocation (optional per dealer).
-- page_path stays pathname-only for all dealers (unchanged).

ALTER TABLE public.smart_ga4_page_data
  ADD COLUMN IF NOT EXISTS page_path_q_s text;

COMMENT ON COLUMN public.smart_ga4_page_data.page_path_q_s IS
  'GA4 pathname + search from pageLocation. Populated for dealers that need query-aware VDP matching (e.g. Destination Cycle).';

CREATE INDEX IF NOT EXISTS idx_smart_ga4_page_data_client_date_path_qs
  ON public.smart_ga4_page_data (client_id, report_date, page_path_q_s)
  WHERE page_path_q_s IS NOT NULL AND btrim(page_path_q_s) <> '';
