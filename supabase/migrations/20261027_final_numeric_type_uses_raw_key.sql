-- build_smart_final_data: a purely numeric Hoot type_ (e.g. Johnson Bros Ford, where type_ carries
-- the feed's custom_label_1 discount amount) is not a vehicle type. For dealers with
-- smart_hoot_config.inv_type_raw_key set, use raw_data ->> inv_type_raw_key instead.
-- Dealers without a raw type key, and non-numeric types, are unchanged.

DO $patch$
DECLARE
  d text;
  anchor text := E'm.price, m.msrp, m.condition, m.type_,\n    COALESCE(\n      NULLIF(TRIM(m.type_), \'\'),';
  repl text := E'm.price, m.msrp, m.condition,\n    -- Numeric type_ (e.g. a feed discount in custom_label_1) is not a vehicle type; use the dealer\'s raw type key.\n    CASE WHEN m.inv_type_raw_key IS NOT NULL AND btrim(m.type_) ~ \'^[0-9.]+$\'\n         THEN COALESCE(NULLIF(TRIM(m.raw_data ->> m.inv_type_raw_key), \'\'), m.type_)\n         ELSE m.type_ END,\n    COALESCE(\n      NULLIF(CASE WHEN m.inv_type_raw_key IS NOT NULL AND btrim(m.type_) ~ \'^[0-9.]+$\' THEN NULL ELSE TRIM(m.type_) END, \'\'),';
BEGIN
  d := pg_get_functiondef('public.build_smart_final_data(text,integer,date,date)'::regprocedure);
  IF position('Numeric type_' in d) > 0 THEN
    RETURN;
  END IF;
  IF (length(d) - length(replace(d, anchor, ''))) / length(anchor) <> 1 THEN
    RAISE EXCEPTION 'build_smart_final_data: type_ anchor not found exactly once';
  END IF;
  EXECUTE replace(d, anchor, repl);
END
$patch$;

-- Also treat type_ equal to the unit's stock number as invalid (Ricks RV: type_ = stock like "9649A").
DO $patch$
DECLARE
  d text;
  anchor text := $a$btrim(m.type_) ~ '^[0-9.]+$'$a$;
  repl   text := $r$(btrim(m.type_) ~ '^[0-9.]+$' OR btrim(m.type_) = btrim(m.stock_number))$r$;
BEGIN
  d := pg_get_functiondef('public.build_smart_final_data(text,integer,date,date)'::regprocedure);
  IF position('btrim(m.type_) = btrim(m.stock_number)' in d) > 0 THEN
    RETURN;
  END IF;
  IF (length(d) - length(replace(d, anchor, ''))) / length(anchor) <> 2 THEN
    RAISE EXCEPTION 'build_smart_final_data: numeric-type condition not found exactly twice';
  END IF;
  EXECUTE replace(d, anchor, repl);
END
$patch$;

-- One-off data fixes applied 2026-10-27:
--   Ricks RV (2562396503): ~18.3K rows Jan 2025–Oct 2026 set from Hoot raw custom_label_0 (RV class),
--   71 more from smart_conner_inventory.type_ by stock number, 224 with no source cleared to NULL.
-- Johnson Bros Ford (27,419 Final rows, Apr–Oct 2026):
-- UPDATE smart_final_data f
-- SET inv_type = btrim(h.raw_data->>'Type'), inv_custom_type = btrim(h.raw_data->>'Type')
-- FROM smart_hoot_inventory h
-- WHERE h.sk = f.inv_sk AND f.client_id = '2113544353'
--   AND btrim(coalesce(f.inv_custom_type, f.inv_type)) ~ '^[0-9.]+$'
--   AND nullif(btrim(h.raw_data->>'Type'), '') IS NOT NULL;
