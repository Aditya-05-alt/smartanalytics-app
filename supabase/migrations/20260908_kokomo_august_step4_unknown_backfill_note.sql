-- Kokomo Honda (4174607404) + Kokomo Toyota (4174607403)
-- 1) smart_vdp_logic_2 VDP regex (Dealer.com brand/year paths)
-- 2) August 2026 Step 4 unknown → inv_* write-back (Hoot hash match, else URL parse)
-- Applied 2026-09-08 via MCP. August only.

UPDATE public.smart_vdp_logic_2
SET
  vdp_logic = CASE dealer_id
    WHEN '4174607404' THEN $r$^/(new|used)/Honda/\d{4}-.+$r$
    WHEN '4174607403' THEN $r$^/(new|used)/Toyota/\d{4}-.+$r$
  END,
  home_page_logic = COALESCE(NULLIF(btrim(home_page_logic), ''), '^/$'),
  updated_at = now()
WHERE dealer_id IN ('4174607404', '4174607403');
