-- Happy Camper RV (5152307309): Interact → Scout live VDP + default location
UPDATE public.smart_vdp_logic
SET
  cms = 'Scout RV',
  vdp_logic = $r$^/(inventory)/(new|used)[/ \-]+.*(\d{4}) OR ^/product/(new|used)-(\d{4})$r$,
  updated_at = now()
WHERE dealer_id = '5152307309';

INSERT INTO public.smart_dealer_locations (customer_id, location_name, created_at, updated_at)
SELECT '5152307309', 'Lafayette, IN', now(), now()
WHERE NOT EXISTS (
  SELECT 1 FROM public.smart_dealer_locations
  WHERE customer_id = '5152307309'
    AND btrim(location_name) = 'Lafayette, IN'
);
