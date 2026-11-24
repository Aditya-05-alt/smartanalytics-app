-- Idempotent log for daily "VDP Analysis complete" email (one per settle/through date).
CREATE TABLE IF NOT EXISTS public.smart_vdp_analysis_complete_email_log (
  through_date date PRIMARY KEY,
  sent_at timestamptz,
  recipients text[],
  dealers integer,
  refreshed integer,
  errors integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.smart_vdp_analysis_complete_email_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.smart_vdp_analysis_complete_email_log FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.smart_vdp_analysis_complete_email_log TO service_role;
