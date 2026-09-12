-- Happy Camper RV (5152307309): logic_2 was Interact + blank pattern;
-- align to Scout RV inventory pattern (A&L-style + golf-cart/pop-up/automotive-other).
UPDATE public.smart_vdp_logic_2
SET
  cms = 'Scout RV',
  vdp_logic = $r$^/inventory/(?:(?:new|used)/\d{4}-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+|(?:new|used)/(?:travel-trailer|fifth-wheel|toy-hauler|class-[abc]|destination-trailer|golf-cart|pop-up|automotive-other)-\d{4}-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+|used-\d{4}-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+)/?$$r$,
  updated_at = now()
WHERE dealer_id = '5152307309';
