-- Optional columns for admin pipeline workflow (run in Supabase SQL editor).

ALTER TABLE public.smart_hoot_config
  ADD COLUMN IF NOT EXISTS account_name text,
  ADD COLUMN IF NOT EXISTS ga4_filter_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS final_vdp_enabled boolean NOT NULL DEFAULT false;

-- Backfill account_name from customer_name where empty:
-- UPDATE public.smart_hoot_config SET account_name = customer_name WHERE account_name IS NULL;
