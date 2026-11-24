-- Airstream of Georgia — show on All Dealers (VDP / All / SRP)
UPDATE public.smart_hoot_config
SET
  show_all_dealers_vdp = true,
  show_all_dealers_all = true,
  show_all_dealers_srp = true
WHERE ga4_customer_id::text = '8824163456';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'smart_conner_config'
      AND column_name = 'show_all_dealers_vdp'
  ) THEN
    UPDATE public.smart_conner_config
    SET
      show_all_dealers_vdp = true,
      show_all_dealers_all = true,
      show_all_dealers_srp = true,
      updated_at = now()
    WHERE ga4_customer_id = '8824163456';
  END IF;
END $$;
