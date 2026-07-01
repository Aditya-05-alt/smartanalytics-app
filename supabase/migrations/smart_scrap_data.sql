-- Scrap inventory mirror of smart_hoot_inventory (external worker upserts daily).
-- Deploy in Supabase SQL editor.

CREATE TABLE IF NOT EXISTS public.smart_scrap_data (
  id               bigserial PRIMARY KEY,
  customer_name    text NOT NULL,
  ga4_customer_id  text,
  url              text NOT NULL,
  url_norm         text GENERATED ALWAYS AS (lower(trim(url))) STORED,
  sk               text,
  vin              text,
  make             text,
  model            text,
  year             integer,
  trim             text,
  price            numeric,
  msrp             numeric,
  condition        text,
  type_            text,
  stock_number     text,
  location         text,
  first_seen       timestamptz,
  last_seen        timestamptz,
  source_list_url  text,
  scraped_at       timestamptz NOT NULL DEFAULT now(),
  scrape_run_id    uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT smart_scrap_data_customer_url_unique UNIQUE (customer_name, url_norm)
);

CREATE INDEX IF NOT EXISTS idx_scrap_data_customer_url
  ON public.smart_scrap_data (customer_name, url_norm);

CREATE INDEX IF NOT EXISTS idx_scrap_data_ga4_customer
  ON public.smart_scrap_data (ga4_customer_id);

CREATE INDEX IF NOT EXISTS idx_scrap_data_last_seen
  ON public.smart_scrap_data (last_seen DESC);

COMMENT ON TABLE public.smart_scrap_data IS
  'Scraped dealer inventory; same grain as smart_hoot_inventory for Step 3 URL matching.';
