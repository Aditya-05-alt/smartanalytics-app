-- Clone of smart_vdp_logic for experimentation / alternate VDP logics.

CREATE TABLE IF NOT EXISTS public.smart_vdp_logic_2 (
  LIKE public.smart_vdp_logic INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'smart_vdp_logic_2_id_seq'
  ) THEN
    CREATE SEQUENCE public.smart_vdp_logic_2_id_seq;
  END IF;
END $$;

ALTER TABLE public.smart_vdp_logic_2
  ALTER COLUMN id SET DEFAULT nextval('public.smart_vdp_logic_2_id_seq');

ALTER SEQUENCE public.smart_vdp_logic_2_id_seq OWNED BY public.smart_vdp_logic_2.id;

INSERT INTO public.smart_vdp_logic_2 (
  id, dealer_name, dealer_id, website_url, cms, data_source,
  hoot_link, scrap_link, vdp_logic, srp_logic, home_page_logic,
  others, created_at, updated_at, ga4_property_id
)
SELECT
  id, dealer_name, dealer_id, website_url, cms, data_source,
  hoot_link, scrap_link, vdp_logic, srp_logic, home_page_logic,
  others, created_at, updated_at, ga4_property_id
FROM public.smart_vdp_logic s
WHERE NOT EXISTS (SELECT 1 FROM public.smart_vdp_logic_2 LIMIT 1);

SELECT setval(
  'public.smart_vdp_logic_2_id_seq',
  COALESCE((SELECT MAX(id) FROM public.smart_vdp_logic_2), 1)
);

COMMENT ON TABLE public.smart_vdp_logic_2 IS
  'Clone of smart_vdp_logic for experimentation / alternate VDP logics.';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.smart_vdp_logic_2 TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.smart_vdp_logic_2_id_seq TO service_role;
