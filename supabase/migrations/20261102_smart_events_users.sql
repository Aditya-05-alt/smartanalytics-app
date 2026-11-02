-- GA4 totalUsers for a whole period (no page/source breakdown), overall and per channel group.
-- Matches the GA4 UI "Total users"; summing smart_ga4_page_data.total_users does not
-- (a user is counted once per page row and once per day).
CREATE TABLE IF NOT EXISTS public.smart_events_users (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id       text NOT NULL,
  ga4_property_id text NOT NULL,
  account_name    text,
  period_from     date NOT NULL,
  period_to       date NOT NULL,
  channel         text NOT NULL,          -- GA4 channel group name, or '(all)' for the overall total
  total_users     integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT smart_events_users_period_key
    UNIQUE (client_id, period_from, period_to, channel),
  CONSTRAINT smart_events_users_config_fkey
    FOREIGN KEY (client_id, ga4_property_id)
    REFERENCES public.smart_ga4_config (client_id, ga4_property_id)
    ON UPDATE CASCADE
);

ALTER TABLE public.smart_events_users ENABLE ROW LEVEL SECURITY;
