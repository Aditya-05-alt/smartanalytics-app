-- SouthWest Volkswagen (9052006098): same site change as SouthWest Nissan around 2026-10-05,
-- from /new-City-YYYY-... paths to /viewdetails/(new|used|cpo)/{vin}/{slug}.
-- 1) VDP logic matches the new paths (old pattern kept for residual legacy URLs).
-- 2) Step 3 reads the mid-path VIN for this dealer too (CPO pages vs Hoot /used/ URLs).

UPDATE public.smart_vdp_logic
SET
  vdp_logic = '^/viewdetails/(new|used|cpo)/ OR ^/(new|used|certified)-[A-Za-z0-9+]+-\d{4}-.+',
  updated_at = now()
WHERE dealer_id = '9052006098';

UPDATE public.smart_vdp_logic_2
SET
  vdp_logic = '^/viewdetails/(new|used|cpo)/ OR ^/(new|used|certified)-[A-Za-z0-9+]+-\d{4}-.+',
  updated_at = now()
WHERE dealer_id = '9052006098';

DO $patch$
DECLARE
  d text;
  anchor text := $a$CASE WHEN g.client_id = '1992343311'$a$;
  repl   text := $r$CASE WHEN g.client_id IN ('1992343311', '9052006098')$r$;
BEGIN
  d := pg_get_functiondef('public.build_smart_final_data(text,integer,date,date)'::regprocedure);
  IF position('9052006098' in d) > 0 THEN
    RETURN;
  END IF;
  IF (length(d) - length(replace(d, anchor, ''))) / length(anchor) <> 1 THEN
    RAISE EXCEPTION 'build_smart_final_data: SouthWest Nissan VIN anchor not found exactly once';
  END IF;
  EXECUTE replace(d, anchor, repl);
END
$patch$;
