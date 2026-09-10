-- Compare page ONLY — daily VDP channel aggregates (vdp_conditions).
-- Not used by Overview or All Dealers.

CREATE TABLE IF NOT EXISTS public.ga4_compare_vdp_channel_daily (
  client_id text NOT NULL,
  report_date date NOT NULL,
  channel text NOT NULL,
  views bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (client_id, report_date, channel)
);

CREATE INDEX IF NOT EXISTS ga4_compare_vdp_channel_daily_date_client
  ON public.ga4_compare_vdp_channel_daily (report_date, client_id);

GRANT SELECT ON public.ga4_compare_vdp_channel_daily TO anon, authenticated, service_role;

COMMENT ON TABLE public.ga4_compare_vdp_channel_daily IS
  'Compare page only: daily VDP channel views where vdp_conditions IS TRUE.';

-- Refresh example (one day):
-- DELETE FROM public.ga4_compare_vdp_channel_daily WHERE report_date = DATE '2026-09-09';
-- INSERT INTO public.ga4_compare_vdp_channel_daily (client_id, report_date, channel, views)
-- SELECT client_id, report_date, channel, SUM(COALESCE(views,0))::bigint
-- FROM public.smart_ga4_page_data
-- WHERE vdp_conditions IS TRUE AND report_date = DATE '2026-09-09'
-- GROUP BY client_id, report_date, channel;
