-- Fast All Dealers VDP monthly aggregates (vdp_conditions — KPI-aligned).
-- Used by get_all_dealers_channel_matrix for full-month VDP and Current Month MTD.
-- Refresh after GA4 sync / Step 2 filtration (per month or rolling).

CREATE TABLE IF NOT EXISTS public.ga4_vdp_channel_monthly (
  client_id text NOT NULL,
  month_start date NOT NULL,
  channel text NOT NULL,
  views bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (client_id, month_start, channel)
);

CREATE INDEX IF NOT EXISTS ga4_vdp_channel_monthly_month_client
  ON public.ga4_vdp_channel_monthly (month_start, client_id);

GRANT SELECT ON public.ga4_vdp_channel_monthly TO anon, authenticated, service_role;

COMMENT ON TABLE public.ga4_vdp_channel_monthly IS
  'All Dealers VDP channel totals by month from smart_ga4_page_data WHERE vdp_conditions IS TRUE. For in-progress months store MTD totals and refresh daily.';

-- Example refresh for Current Month MTD (through latest synced day):
-- DELETE FROM public.ga4_vdp_channel_monthly WHERE month_start = DATE '2026-09-01';
-- INSERT INTO public.ga4_vdp_channel_monthly (client_id, month_start, channel, views)
-- SELECT client_id, DATE '2026-09-01', channel, SUM(COALESCE(views,0))::bigint
-- FROM public.smart_ga4_page_data
-- WHERE vdp_conditions IS TRUE
--   AND report_date BETWEEN DATE '2026-09-01' AND DATE '2026-09-09'
-- GROUP BY client_id, channel;
