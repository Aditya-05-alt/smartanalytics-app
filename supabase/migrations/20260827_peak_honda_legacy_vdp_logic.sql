-- Peak Honda World (2721177227): ScoutX legacy VDP URLs pre-June-2026.
-- Old: /inventory/2025-honda-...-littleton-co-80123-13500485i
-- New: /inventory/new/2025-honda-...-s4902340  (unchanged)

UPDATE smart_vdp_logic
SET vdp_logic = '^/inventory/(?:new|used)/\d{4}-.+|^/inventory/.+-[0-9]+[a-z]?$',
    updated_at = NOW()
WHERE dealer_id = '2721177227';
