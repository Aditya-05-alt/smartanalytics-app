-- smart_scrap_inventory — fallback inventory for Step 3 when smart_hoot_inventory has no match.
-- Deploy in Supabase SQL editor before build_smart_final_data.sql.

CREATE OR REPLACE FUNCTION public.smart_scrap_inventory_touch_last_seen()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.last_seen IS NULL THEN
    NEW.last_seen := now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.smart_scrap_inventory (
  sk text NOT NULL,
  vin text NULL,
  url text NULL,
  advertiser text NULL,
  customer_id character varying(128) NULL,
  make text NULL,
  model text NULL,
  year text NULL,
  price numeric(12, 2) NULL,
  condition text NULL,
  first_seen timestamp with time zone NULL DEFAULT now(),
  last_seen timestamp with time zone NULL,
  raw_data jsonb NULL,
  customer_name text NULL,
  location text NULL,
  msrp numeric(12, 2) NULL,
  type_ text NULL,
  trim text NULL,
  stock_number text NULL,
  website_platform text NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT smart_scrap_inventory_pkey PRIMARY KEY (sk)
);

CREATE INDEX IF NOT EXISTS idx_smart_scrap_inventory_customer_id
  ON public.smart_scrap_inventory USING btree (customer_id);

CREATE INDEX IF NOT EXISTS idx_smart_scrap_inventory_customer_name
  ON public.smart_scrap_inventory USING btree (customer_name);

CREATE INDEX IF NOT EXISTS idx_smart_scrap_inventory_last_seen
  ON public.smart_scrap_inventory USING btree (last_seen DESC);

DROP TRIGGER IF EXISTS trg_smart_scrap_inventory_touch ON public.smart_scrap_inventory;

CREATE TRIGGER trg_smart_scrap_inventory_touch
  BEFORE UPDATE ON public.smart_scrap_inventory
  FOR EACH ROW
  EXECUTE FUNCTION public.smart_scrap_inventory_touch_last_seen();

-- Optional: worker completion marker (used by upsert_scrap_inventory_batch).
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
