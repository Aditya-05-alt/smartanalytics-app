-- Dealer category for Admin → Dealers (and future VDP report filtering).
-- Run in Supabase SQL editor if migrations are applied manually.

ALTER TABLE public.smart_hoot_config
  ADD COLUMN IF NOT EXISTS dealer_category text;

COMMENT ON COLUMN public.smart_hoot_config.dealer_category IS
  'Dealer vertical: Auto, Boats, Marine, Motorcycle, Powersports, Powersports/RV, RV, Service';
