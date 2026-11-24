-- Normalize GA4 medium labels for VDP filter matching
-- ("Organic" ≡ "organic", "(none)" ≡ empty / null).

CREATE OR REPLACE FUNCTION public.vdp_medium_key(p_medium text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(btrim(COALESCE(NULLIF(btrim(COALESCE(p_medium, '')), ''), '(none)')));
$$;

CREATE OR REPLACE FUNCTION public.vdp_medium_matches(
  p_medium text,
  p_mediums text[]
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    COALESCE(array_length(p_mediums, 1), 0) = 0
    OR public.vdp_medium_key(p_medium) = ANY (
      SELECT public.vdp_medium_key(m)
      FROM unnest(p_mediums) AS m
    );
$$;

-- True when a final-data VDP row has GA4 page traffic in any selected medium.
CREATE OR REPLACE FUNCTION public.vdp_final_matches_mediums(
  p_client_id text,
  p_report_date date,
  p_page_path text,
  p_mediums text[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(array_length(p_mediums, 1), 0) = 0
    OR EXISTS (
      SELECT 1
      FROM public.smart_ga4_page_data p
      WHERE p.client_id::text = trim(p_client_id)
        AND p.report_date = p_report_date
        AND TRIM(COALESCE(p.page_path, '')) = TRIM(COALESCE(p_page_path, ''))
        AND p.vdp_conditions IS TRUE
        AND public.vdp_medium_matches(p.medium, p_mediums)
    );
$$;

GRANT EXECUTE ON FUNCTION public.vdp_medium_key(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.vdp_medium_matches(text, text[]) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.vdp_final_matches_mediums(text, date, text, text[])
  TO anon, authenticated, service_role;
