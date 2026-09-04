-- Midway RV Center (6460838510) August 2026 unknown → inv_* backfill.
-- Parse /product/{condition}-{year}-{make}-{model}-{listing}-{dealer}
-- Resolve make/model via smart_make / smart_models (Interact RV), longest slug match.
-- Applied 2026-09-03 via MCP. One-time.

-- Ensure missing Interact make used by Midway URL slugs
INSERT INTO public.smart_make (cms, make)
VALUES ('Interact RV', 'Midwest Automotive Designs')
ON CONFLICT (cms, make) DO NOTHING;

-- Match-only regex for logic_2 (Postgres POSIX; no Python named groups)
UPDATE public.smart_vdp_logic_2
SET vdp_logic = '^/product/(new|used)-[0-9]{4}-[a-zA-Z0-9]+(-[a-zA-Z0-9]+)+-[0-9]+-[0-9]+$',
    updated_at = now()
WHERE dealer_id = '6460838510';
