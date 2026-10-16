-- SouthWest Nissan site moved from /new-City-YYYY-... paths to
-- /viewdetails/(new|used|cpo)/{vin}/{slug} around 2026-10-05.
-- Keep the old pattern so residual legacy URLs still match.

UPDATE public.smart_vdp_logic
SET
  vdp_logic = '^/viewdetails/(new|used|cpo)/ OR ^/(new|used|certified)-[A-Za-z0-9+]+-\d{4}-.+',
  updated_at = now()
WHERE dealer_id = '1992343311';

UPDATE public.smart_vdp_logic_2
SET
  vdp_logic = '^/viewdetails/(new|used|cpo)/ OR ^/(new|used|certified)-[A-Za-z0-9+]+-\d{4}-.+',
  updated_at = now()
WHERE dealer_id = '1992343311';
