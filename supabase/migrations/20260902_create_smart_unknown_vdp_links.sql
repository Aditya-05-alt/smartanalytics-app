-- Staging table for Unknown VDP links from smart_final_data.
-- Flow (later): copy unknown links here → filter via smart_vdp_logic_2 → write back to final.
-- Schema only; no data loaded.

CREATE SEQUENCE IF NOT EXISTS public.smart_unknown_vdp_links_id_seq
  AS bigint
  START WITH 1
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  CACHE 1;

CREATE TABLE IF NOT EXISTS public.smart_unknown_vdp_links (
  id bigint NOT NULL DEFAULT nextval('public.smart_unknown_vdp_links_id_seq'::regclass),
  source_final_id bigint NULL,
  client_id text NOT NULL,
  ga4_property_id text NULL,
  account_name text NULL,
  report_date date NULL,
  -- Link copies (from smart_final_data)
  page_path text NOT NULL,
  page_location text NULL,
  page_title text NULL,
  views integer NULL,
  cms text NULL,
  -- Pipeline status: pending → matched (logic_2) → applied (back to final)
  status text NOT NULL DEFAULT 'pending',
  matched_vdp_logic text NULL,
  -- Parsed fields filled after smart_vdp_logic_2 (before write-back)
  inv_url text NULL,
  inv_condition text NULL,
  inv_year text NULL,
  inv_make text NULL,
  inv_model text NULL,
  inv_type text NULL,
  inv_stock_number text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz NULL,
  CONSTRAINT smart_unknown_vdp_links_pkey PRIMARY KEY (id),
  CONSTRAINT smart_unknown_vdp_links_status_check
    CHECK (status = ANY (ARRAY['pending'::text, 'matched'::text, 'applied'::text, 'skipped'::text]))
);

ALTER SEQUENCE public.smart_unknown_vdp_links_id_seq
  OWNED BY public.smart_unknown_vdp_links.id;

CREATE INDEX IF NOT EXISTS idx_smart_unknown_vdp_links_client_path
  ON public.smart_unknown_vdp_links (client_id, page_path);

CREATE INDEX IF NOT EXISTS idx_smart_unknown_vdp_links_status
  ON public.smart_unknown_vdp_links (status);

CREATE INDEX IF NOT EXISTS idx_smart_unknown_vdp_links_client_date
  ON public.smart_unknown_vdp_links (client_id, report_date);

CREATE UNIQUE INDEX IF NOT EXISTS idx_smart_unknown_vdp_links_source_final
  ON public.smart_unknown_vdp_links (source_final_id)
  WHERE source_final_id IS NOT NULL;

ALTER TABLE public.smart_unknown_vdp_links ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.smart_unknown_vdp_links IS
  'Staging copy of Unknown VDP links from smart_final_data. Filter via smart_vdp_logic_2, then write matched inv_* back to final.';

COMMENT ON COLUMN public.smart_unknown_vdp_links.page_path IS
  'Copied page_path / link from smart_final_data (Unknown rows).';

COMMENT ON COLUMN public.smart_unknown_vdp_links.page_location IS
  'Copied full page_location URL from smart_final_data when available.';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.smart_unknown_vdp_links TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.smart_unknown_vdp_links_id_seq TO service_role;
