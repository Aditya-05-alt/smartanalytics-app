-- Email send log + config for inventory / scrap daily SMTP reports.
-- Deploy in Supabase SQL editor (safe if tables already exist).

CREATE TABLE IF NOT EXISTS public.smart_inventory_email_config (
  id              integer PRIMARY KEY DEFAULT 1,
  enabled         boolean NOT NULL DEFAULT true,
  recipients      text[] NOT NULL DEFAULT '{}',
  cc_recipients   text[] NOT NULL DEFAULT '{}',
  from_name       text,
  from_email      text,
  subject_prefix  text,
  CONSTRAINT smart_inventory_email_config_singleton CHECK (id = 1)
);

INSERT INTO public.smart_inventory_email_config (id, enabled)
VALUES (1, true)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.smart_inventory_email_log (
  id            bigserial PRIMARY KEY,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  ok            boolean NOT NULL DEFAULT false,
  recipients    text[],
  hoot_rows     integer,
  scrap_rows    integer,
  total_rows    integer,
  dealer_count  integer,
  csv_bytes     bigint,
  storage_path  text,
  provider_id   text,
  error         text,
  meta          jsonb
);

CREATE INDEX IF NOT EXISTS idx_inventory_email_log_started
  ON public.smart_inventory_email_log (started_at DESC);

CREATE INDEX IF NOT EXISTS idx_inventory_email_log_ok_started
  ON public.smart_inventory_email_log (ok, started_at DESC);
