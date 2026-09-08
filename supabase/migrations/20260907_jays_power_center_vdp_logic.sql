-- Jay's Power Center (7543766464): VDP/SRP were swapped.
-- Old VDP matched SRP listing pages (xNewInventory / xAllInventory / xPreOwnedInventory).
-- Real VDPs are SEO unit paths, /--xInventoryDetail, Spike ?page=*InventoryDetail, PrintInventory.

UPDATE public.smart_vdp_logic
SET
  vdp_logic = '^/(New|Used|Pre-Owned|Pre-owned)-Inventory-.+-[0-9]+$ OR ^/--xInventoryDetail OR [?&]page=xInventoryDetail OR [?&]page=xNewInventoryDetail OR [?&]page=xPreOwnedInventoryDetail OR ^/PrintInventory-.+--id-[0-9]+',
  srp_logic = '--x(All|New|PreOwned)Inventory([^A-Za-z]|$)|[?&]page=x(All|New|PreOwned)Inventory([^A-Za-z]|$)|^/--x(All|New|PreOwned)[Ii]nventory',
  home_page_logic = '^/$',
  updated_at = now()
WHERE dealer_id = '7543766464';

UPDATE public.smart_vdp_logic_2
SET
  vdp_logic = '^/(New|Used|Pre-Owned|Pre-owned)-Inventory-.+-[0-9]+$ OR ^/--xInventoryDetail OR [?&]page=xInventoryDetail OR [?&]page=xNewInventoryDetail OR [?&]page=xPreOwnedInventoryDetail OR ^/PrintInventory-.+--id-[0-9]+',
  srp_logic = '--x(All|New|PreOwned)Inventory([^A-Za-z]|$)|[?&]page=x(All|New|PreOwned)Inventory([^A-Za-z]|$)|^/--x(All|New|PreOwned)[Ii]nventory',
  home_page_logic = '^/$',
  updated_at = now()
WHERE dealer_id = '7543766464';
