-- Johnson Bros Ford (2113544353): site moved to /viewdetails/(new|used|cpo)/{vin}[/{slug}] around
-- 2026-10-19 while Hoot still lists /new-Johnson+Brothers-...-{VIN} URLs.
-- 1) VDP logic matches the new paths (old pattern kept for residual legacy URLs).
-- 2) Step 3 reads the mid-path VIN for this dealer too, and accepts a VIN at the end of the
--    path (some viewdetails URLs have no slug after the VIN).

UPDATE public.smart_vdp_logic
SET
  vdp_logic = '^/viewdetails/(new|used|cpo)/ OR ^/(new|used)-Johnson\+Brothers-\d{4}-.+$',
  updated_at = now()
WHERE dealer_id = '2113544353';

UPDATE public.smart_vdp_logic_2
SET
  vdp_logic = '^/viewdetails/(new|used|cpo)/ OR ^/(new|used)-Johnson\+Brothers-\d{4}-.+$',
  updated_at = now()
WHERE dealer_id = '2113544353';

DO $patch$
DECLARE
  d text;
  a1 text := $a$CASE WHEN g.client_id IN ('1992343311', '9052006098')$a$;
  r1 text := $r$CASE WHEN g.client_id IN ('1992343311', '9052006098', '2113544353')$r$;
  a2 text := $a$'^/viewdetails/(?:new|used|cpo)/([A-Za-z0-9]{17})/'$a$;
  r2 text := $r$'^/viewdetails/(?:new|used|cpo)/([A-Za-z0-9]{17})(?:/|$)'$r$;
BEGIN
  d := pg_get_functiondef('public.build_smart_final_data(text,integer,date,date)'::regprocedure);
  IF position('2113544353' in d) > 0 THEN
    RETURN;
  END IF;
  IF (length(d) - length(replace(d, a1, ''))) / length(a1) <> 1
     OR (length(d) - length(replace(d, a2, ''))) / length(a2) <> 1 THEN
    RAISE EXCEPTION 'build_smart_final_data: viewdetails VIN anchors not found exactly once';
  END IF;
  EXECUTE replace(replace(d, a1, r1), a2, r2);
END
$patch$;
