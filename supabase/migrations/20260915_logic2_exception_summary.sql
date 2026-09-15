-- Per-dealer exception summary for Unknown/Other cleanup status email.

CREATE OR REPLACE FUNCTION public.get_logic2_exception_summary()
RETURNS TABLE (
  customer_id text,
  dealer_name text,
  cms text,
  exception_urls bigint,
  total_views bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    e.customer_id,
    MAX(NULLIF(btrim(e.dealer_name), '')) AS dealer_name,
    MAX(NULLIF(btrim(e.cms), '')) AS cms,
    COUNT(*)::bigint AS exception_urls,
    COALESCE(SUM(e.views), 0)::bigint AS total_views
  FROM public.smart_exception_data e
  GROUP BY e.customer_id
  ORDER BY COUNT(*) DESC, MAX(NULLIF(btrim(e.dealer_name), '')) NULLS LAST;
$$;

COMMENT ON FUNCTION public.get_logic2_exception_summary() IS
  'Per-dealer exception URL counts for Unknown/Other cleanup status email.';

REVOKE ALL ON FUNCTION public.get_logic2_exception_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_logic2_exception_summary() TO service_role;
