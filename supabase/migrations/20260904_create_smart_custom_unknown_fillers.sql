-- CMS-scoped make + model + type combinations for unknown VDP fill.

CREATE SEQUENCE IF NOT EXISTS public.smart_custom_unknown_fillers_id_seq
  AS bigint
  START WITH 1
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  CACHE 1;

CREATE TABLE IF NOT EXISTS public.smart_custom_unknown_fillers (
  id bigint NOT NULL DEFAULT nextval('public.smart_custom_unknown_fillers_id_seq'::regclass),
  cms text NOT NULL,
  make text NOT NULL,
  model text NOT NULL,
  type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT smart_custom_unknown_fillers_pkey PRIMARY KEY (id),
  CONSTRAINT smart_custom_unknown_fillers_cms_make_model_type_key UNIQUE (cms, make, model, type)
);

ALTER SEQUENCE public.smart_custom_unknown_fillers_id_seq OWNED BY public.smart_custom_unknown_fillers.id;

CREATE INDEX IF NOT EXISTS idx_smart_custom_unknown_fillers_cms
  ON public.smart_custom_unknown_fillers (cms);
CREATE INDEX IF NOT EXISTS idx_smart_custom_unknown_fillers_make
  ON public.smart_custom_unknown_fillers (make);
CREATE INDEX IF NOT EXISTS idx_smart_custom_unknown_fillers_model
  ON public.smart_custom_unknown_fillers (model);
CREATE INDEX IF NOT EXISTS idx_smart_custom_unknown_fillers_type
  ON public.smart_custom_unknown_fillers (type);

COMMENT ON TABLE public.smart_custom_unknown_fillers IS
  'CMS-scoped make/model/type combinations used to fill unknown VDP inventory (e.g. Interact RV).';

ALTER TABLE public.smart_custom_unknown_fillers ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.smart_custom_unknown_fillers TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.smart_custom_unknown_fillers_id_seq TO service_role;

GRANT SELECT ON public.smart_custom_unknown_fillers TO authenticated;
