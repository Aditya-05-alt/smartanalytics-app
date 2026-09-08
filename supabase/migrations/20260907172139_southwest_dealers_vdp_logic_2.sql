-- SouthWest Nissan (1992343311) + SouthWest Volkswagen (9052006098)
-- DealerOn VDP: /{condition}-{city}-{year}-{make}-{model...}-{vin}
-- City/model can include '+' (Fort+Worth, F+150, 20T+SE). logic_2 was NULL.

UPDATE public.smart_vdp_logic_2
SET
  vdp_logic = $r$^/(new|used|certified)-[A-Za-z0-9+]+-\d{4}-.+$r$,
  home_page_logic = '^/$',
  updated_at = now()
WHERE dealer_id IN ('1992343311', '9052006098');
