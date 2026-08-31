-- Clone smart_ga4_page_data → smart_ga4_page_ps_data (schema only, empty table).
-- PS = parallel/supplemental page source table for future data loads.

CREATE SEQUENCE IF NOT EXISTS public.smart_ga4_page_ps_data_id_seq
  AS integer
  START WITH 1
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  CACHE 1;

CREATE TABLE IF NOT EXISTS public.smart_ga4_page_ps_data (
  id integer NOT NULL DEFAULT nextval('smart_ga4_page_ps_data_id_seq'::regclass),
  client_id text NOT NULL,
  ga4_property_id text NOT NULL,
  account_name text NULL,
  report_date date NOT NULL,
  page_location text NULL,
  page_path text NOT NULL,
  page_title text NULL,
  session_campaign text NULL,
  channel text NULL,
  source text NULL,
  medium text NULL,
  source_medium text NULL,
  views integer NULL DEFAULT 0,
  total_users integer NULL DEFAULT 0,
  sessions integer NULL DEFAULT 0,
  new_users integer NULL DEFAULT 0,
  created_at timestamp with time zone NULL DEFAULT now(),
  vdp_conditions boolean NULL DEFAULT false,
  vdp_vehicle_condition text NULL,
  year integer NULL,
  ga4_page_type text NULL,
  cms text NULL,
  CONSTRAINT smart_ga4_page_ps_data_pkey PRIMARY KEY (id)
);

ALTER SEQUENCE public.smart_ga4_page_ps_data_id_seq OWNED BY public.smart_ga4_page_ps_data.id;

-- Mirror indexes from smart_ga4_page_data
CREATE INDEX IF NOT EXISTS idx_smart_ga4_page_ps_data_date_client
  ON public.smart_ga4_page_ps_data (report_date, client_id);

CREATE INDEX IF NOT EXISTS idx_smart_ga4_page_ps_data_client_date
  ON public.smart_ga4_page_ps_data (client_id, report_date);

CREATE INDEX IF NOT EXISTS idx_ga4_page_ps_data_client_date_channel
  ON public.smart_ga4_page_ps_data (client_id, report_date, channel);

CREATE INDEX IF NOT EXISTS idx_ga4_page_ps_data_client_date_pagetype
  ON public.smart_ga4_page_ps_data (client_id, report_date, ga4_page_type);

CREATE INDEX IF NOT EXISTS idx_ga4_page_ps_data_join
  ON public.smart_ga4_page_ps_data (client_id, report_date, page_path);

CREATE INDEX IF NOT EXISTS idx_ga4_page_ps_channel
  ON public.smart_ga4_page_ps_data (client_id, report_date, channel)
  WHERE ga4_page_type ~~ 'VDP%'::text;

CREATE INDEX IF NOT EXISTS smart_ga4_page_ps_data_vdp
  ON public.smart_ga4_page_ps_data (client_id, vdp_conditions)
  WHERE vdp_conditions = true;

ALTER TABLE public.smart_ga4_page_ps_data ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.smart_ga4_page_ps_data IS
  'Clone of smart_ga4_page_data for PS (supplemental) GA4 page loads. Same columns and indexes.';

GRANT ALL ON TABLE public.smart_ga4_page_ps_data TO anon, authenticated, service_role;
GRANT ALL ON SEQUENCE public.smart_ga4_page_ps_data_id_seq TO anon, authenticated, service_role;
