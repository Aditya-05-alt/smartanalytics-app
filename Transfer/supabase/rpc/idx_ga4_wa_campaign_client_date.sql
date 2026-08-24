-- Supporting index for get_wa_campaign_views_advance (run once in Supabase SQL editor).
-- CONCURRENTLY cannot run inside a transaction block.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ga4_wa_campaign_client_date
  ON public.smart_ga4_page_data (client_id, report_date)
  WHERE session_campaign ~ '^[[:space:]]*WA ?\|';
