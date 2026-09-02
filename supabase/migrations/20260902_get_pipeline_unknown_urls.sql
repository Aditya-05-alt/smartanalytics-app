-- Pipeline Step 4: unique Unknown/Other URLs + counts for a dealer date range.

CREATE OR REPLACE FUNCTION public.get_pipeline_unknown_urls(
  p_client_id text,
  p_from date,
  p_to date
)
RETURNS TABLE (
  page_path text,
  page_location text,
  rows bigint,
  views bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    f.page_path,
    MAX(NULLIF(btrim(f.page_location), '')) AS page_location,
    COUNT(*)::bigint AS rows,
    SUM(COALESCE(f.views, 0))::bigint AS views
  FROM public.smart_final_data f
  WHERE f.client_id::text = trim(p_client_id)
    AND f.report_date BETWEEN p_from AND p_to
    AND (
      NULLIF(btrim(f.inv_url), '') IS NULL
      OR f.vdp_conditions IS DISTINCT FROM TRUE
      OR NULLIF(btrim(f.inv_make), '') IS NULL
      OR lower(btrim(f.inv_make)) IN ('unknown', 'other')
    )
  GROUP BY f.page_path
  ORDER BY views DESC, f.page_path;
$$;

COMMENT ON FUNCTION public.get_pipeline_unknown_urls(text, date, date) IS
  'Admin Pipeline Step 4 — unique Unknown/Other final URLs with row + view counts.';

REVOKE ALL ON FUNCTION public.get_pipeline_unknown_urls(text, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_pipeline_unknown_urls(text, date, date)
  TO anon, authenticated, service_role;
