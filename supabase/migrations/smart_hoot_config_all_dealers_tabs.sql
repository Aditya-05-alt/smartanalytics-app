-- All Dealers portfolio: which overview tabs include this dealer.
-- Default ON (same as before) — turn OFF in Admin → Dealers to hide from that All Dealers tab.
ALTER TABLE public.smart_hoot_config
  ADD COLUMN IF NOT EXISTS show_all_dealers_vdp boolean NOT NULL DEFAULT true;

ALTER TABLE public.smart_hoot_config
  ADD COLUMN IF NOT EXISTS show_all_dealers_all boolean NOT NULL DEFAULT true;

ALTER TABLE public.smart_hoot_config
  ADD COLUMN IF NOT EXISTS show_all_dealers_srp boolean NOT NULL DEFAULT true;

-- If columns already existed with default false, turn everyone back on (restore prior All Dealers list).
UPDATE public.smart_hoot_config
SET
  show_all_dealers_vdp = true,
  show_all_dealers_all = true,
  show_all_dealers_srp = true
WHERE show_all_dealers_vdp IS DISTINCT FROM true
   OR show_all_dealers_all IS DISTINCT FROM true
   OR show_all_dealers_srp IS DISTINCT FROM true;

COMMENT ON COLUMN public.smart_hoot_config.show_all_dealers_vdp IS
  'When true, include this dealer in All Dealers → VDP portfolio matrix. Default on.';
COMMENT ON COLUMN public.smart_hoot_config.show_all_dealers_all IS
  'When true, include this dealer in All Dealers → All Pages portfolio matrix. Default on.';
COMMENT ON COLUMN public.smart_hoot_config.show_all_dealers_srp IS
  'When true, include this dealer in All Dealers → SRP portfolio matrix. Default on.';
