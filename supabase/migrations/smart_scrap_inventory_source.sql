-- Dealer inventory source (hoot vs scrap) + daily scrape completion markers.
-- Deploy in Supabase SQL editor.

ALTER TABLE public.smart_hoot_config
  ADD COLUMN IF NOT EXISTS inventory_source text NOT NULL DEFAULT 'hoot';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'smart_hoot_config_inventory_source_check'
  ) THEN
    ALTER TABLE public.smart_hoot_config
      ADD CONSTRAINT smart_hoot_config_inventory_source_check
      CHECK (inventory_source IN ('hoot', 'scrap'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.smart_scrap_day_complete (
  id                bigserial PRIMARY KEY,
  ga4_customer_id   text NOT NULL,
  report_date       date NOT NULL,
  row_count         integer NOT NULL DEFAULT 0,
  scrape_run_id     uuid,
  completed_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT smart_scrap_day_complete_unique UNIQUE (ga4_customer_id, report_date)
);

CREATE INDEX IF NOT EXISTS idx_scrap_day_complete_client_date
  ON public.smart_scrap_day_complete (ga4_customer_id, report_date);

CREATE TABLE IF NOT EXISTS public.smart_scrap_run_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ga4_customer_id   text,
  customer_name     text,
  started_at        timestamptz NOT NULL DEFAULT now(),
  finished_at       timestamptz,
  status            text NOT NULL DEFAULT 'running',
  row_count         integer NOT NULL DEFAULT 0,
  error_message     text,
  scrape_run_id     uuid NOT NULL DEFAULT gen_random_uuid()
);

CREATE INDEX IF NOT EXISTS idx_scrap_run_log_started
  ON public.smart_scrap_run_log (started_at DESC);
