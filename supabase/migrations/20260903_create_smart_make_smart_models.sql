-- Reference tables: CMS-scoped make and model catalogs.

CREATE SEQUENCE IF NOT EXISTS public.smart_make_id_seq
  AS bigint
  START WITH 1
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  CACHE 1;

CREATE TABLE IF NOT EXISTS public.smart_make (
  id bigint NOT NULL DEFAULT nextval('public.smart_make_id_seq'::regclass),
  cms text NOT NULL,
  make text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT smart_make_pkey PRIMARY KEY (id),
  CONSTRAINT smart_make_cms_make_key UNIQUE (cms, make)
);

ALTER SEQUENCE public.smart_make_id_seq OWNED BY public.smart_make.id;

CREATE INDEX IF NOT EXISTS idx_smart_make_cms ON public.smart_make (cms);
CREATE INDEX IF NOT EXISTS idx_smart_make_make ON public.smart_make (make);

COMMENT ON TABLE public.smart_make IS
  'CMS-scoped vehicle make catalog (e.g. Interact RV makes).';

CREATE SEQUENCE IF NOT EXISTS public.smart_models_id_seq
  AS bigint
  START WITH 1
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  CACHE 1;

CREATE TABLE IF NOT EXISTS public.smart_models (
  id bigint NOT NULL DEFAULT nextval('public.smart_models_id_seq'::regclass),
  cms text NOT NULL,
  model text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT smart_models_pkey PRIMARY KEY (id),
  CONSTRAINT smart_models_cms_model_key UNIQUE (cms, model)
);

ALTER SEQUENCE public.smart_models_id_seq OWNED BY public.smart_models.id;

CREATE INDEX IF NOT EXISTS idx_smart_models_cms ON public.smart_models (cms);
CREATE INDEX IF NOT EXISTS idx_smart_models_model ON public.smart_models (model);

COMMENT ON TABLE public.smart_models IS
  'CMS-scoped vehicle model catalog (e.g. Interact RV models).';

ALTER TABLE public.smart_make ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.smart_models ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.smart_make TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.smart_models TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.smart_make_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.smart_models_id_seq TO service_role;

GRANT SELECT ON public.smart_make TO authenticated;
GRANT SELECT ON public.smart_models TO authenticated;
