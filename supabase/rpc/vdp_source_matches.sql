-- Normalize GA4 sources for VDP filter matching.
-- Matching is equality against an expanded alias list from the app (fast, like channel).
-- vdp_source_key still rolls up hosts for breakdown buckets / options.

CREATE OR REPLACE FUNCTION public.vdp_source_key(p_source text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN v = '' OR v IN ('(none)', '(not set)', '(notset)', '(direct)') THEN '(none)'
    WHEN v IN (
      'facebook', 'fb', 'facebook.com', 'www.facebook.com',
      'm.facebook.com', 'l.facebook.com', 'lm.facebook.com', 'fb.com'
    ) OR v LIKE '%.facebook.com' OR v LIKE '%.fb.com'
      THEN 'facebook.com'
    WHEN v IN ('instagram', 'instagram.com', 'www.instagram.com')
      OR v LIKE '%.instagram.com'
      THEN 'instagram.com'
    WHEN v IN ('youtube', 'youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be')
      OR v LIKE '%.youtube.com'
      THEN 'youtube.com'
    WHEN v IN ('msn', 'msn.com', 'www.msn.com', 'ntp.msn.com')
      OR v LIKE '%.msn.com'
      THEN 'msn.com'
    WHEN v LIKE 'www.%' THEN substr(v, 5)
    ELSE v
  END
  FROM (
    SELECT lower(btrim(COALESCE(p_source, ''))) AS v
  ) s;
$$;

-- Fast: equality only. App expands facebook.com / msn.com / … into raw aliases.
CREATE OR REPLACE FUNCTION public.vdp_source_matches(
  p_source text,
  p_sources text[]
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT
    p_sources IS NULL
    OR cardinality(p_sources) IS NULL
    OR cardinality(p_sources) = 0
    OR lower(btrim(COALESCE(p_source, ''))) = ANY (p_sources)
    OR (
      NULLIF(btrim(COALESCE(p_source, '')), '') IS NULL
      AND '(none)' = ANY (p_sources)
    );
$$;

CREATE OR REPLACE FUNCTION public.vdp_final_matches_sources(
  p_client_id text,
  p_report_date date,
  p_page_path text,
  p_sources text[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(array_length(p_sources, 1), 0) = 0
    OR EXISTS (
      SELECT 1
      FROM public.smart_ga4_page_data p
      WHERE p.client_id::text = trim(p_client_id)
        AND p.report_date = p_report_date
        AND TRIM(COALESCE(p.page_path, '')) = TRIM(COALESCE(p_page_path, ''))
        AND p.vdp_conditions IS TRUE
        AND public.vdp_source_matches(p.source, p_sources)
    );
$$;

GRANT EXECUTE ON FUNCTION public.vdp_source_key(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.vdp_source_matches(text, text[]) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.vdp_final_matches_sources(text, date, text, text[])
  TO anon, authenticated, service_role;
