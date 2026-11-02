-- GA4 form events (eventName x channel x page) per dealer per day.
-- client_id alone is not unique in smart_ga4_page_data or smart_ga4_config, so the FK
-- targets the unique (client_id, ga4_property_id) pair of smart_ga4_config.
CREATE TABLE IF NOT EXISTS public.smart_events_data (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id       text NOT NULL,
  ga4_property_id text NOT NULL,
  account_name    text,
  report_date     date NOT NULL,
  event_name      text NOT NULL,
  page_location   text,
  page_path       text,
  channel         text,
  source          text,
  medium          text,
  source_medium   text,
  session_campaign text,
  event_count     integer NOT NULL DEFAULT 0,
  total_users     integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT smart_events_data_config_fkey
    FOREIGN KEY (client_id, ga4_property_id)
    REFERENCES public.smart_ga4_config (client_id, ga4_property_id)
    ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_smart_events_data_client_date_event
  ON public.smart_events_data (client_id, report_date, event_name);
CREATE INDEX IF NOT EXISTS idx_smart_events_data_client_date_channel
  ON public.smart_events_data (client_id, report_date, channel);

ALTER TABLE public.smart_events_data ENABLE ROW LEVEL SECURITY;
