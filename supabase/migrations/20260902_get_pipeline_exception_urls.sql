-- Pipeline Step 4 Exception: Unknown/Other URLs that still do NOT match smart_vdp_logic_2.

CREATE OR REPLACE FUNCTION public.get_pipeline_exception_urls(
  p_client_id text,
  p_from date,
  p_to date
)
RETURNS TABLE (
  page_path text,
  page_location text,
  rows bigint,
  views bigint,
  matches_logic_2 boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH logic AS (
    SELECT NULLIF(btrim(v.vdp_logic), '') AS vdp_logic
    FROM public.smart_vdp_logic_2 v
    WHERE v.dealer_id::text = trim(p_client_id)
    LIMIT 1
  ),
  unknown AS (
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
  )
  SELECT
    u.page_path,
    u.page_location,
    u.rows,
    u.views,
    false AS matches_logic_2
  FROM unknown u
  WHERE
    (SELECT vdp_logic FROM logic) IS NULL
    OR NOT public.page_path_matches_vdp_logic(
      u.page_path,
      (SELECT vdp_logic FROM logic)
    )
  ORDER BY u.views DESC, u.page_path;
$$;

COMMENT ON FUNCTION public.get_pipeline_exception_urls(text, date, date) IS
  'Admin Pipeline Step 4 Exception — Unknown/Other URLs that do not match smart_vdp_logic_2.';

REVOKE ALL ON FUNCTION public.get_pipeline_exception_urls(text, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_pipeline_exception_urls(text, date, date)
  TO anon, authenticated, service_role;
