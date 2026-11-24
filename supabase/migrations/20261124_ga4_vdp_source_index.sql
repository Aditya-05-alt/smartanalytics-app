-- Speed Source filter / KPI / breakdown (parity with channel INCLUDE indexes).
CREATE INDEX IF NOT EXISTS idx_ga4_page_vdp_client_date_source
ON public.smart_ga4_page_data (client_id, report_date, source)
INCLUDE (views)
WHERE vdp_conditions IS TRUE;
