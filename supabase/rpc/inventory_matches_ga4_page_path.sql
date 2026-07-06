-- Step 3 inventory ↔ GA4 page_path matching.
-- 1) VIN match (scrap dealers: spaces vs underscores, extra -Touring- segments, etc.)
-- 2) Legacy substring match on full URL (hoot + dealers where paths align)
-- Deploy before build_smart_final_data_scrap.sql.

CREATE OR REPLACE FUNCTION public.inventory_matches_ga4_page_path(
  p_page_path text,
  p_inv_url   text,
  p_inv_vin   text DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  WITH ga4_vin AS (
    SELECT public.extract_vin_from_text(p_page_path) AS v
  ),
  inv_vin AS (
    SELECT COALESCE(
      NULLIF(upper(btrim(p_inv_vin)), ''),
      public.extract_vin_from_text(p_inv_url)
    ) AS v
  )
  SELECT
    -- VIN match (preferred for scrap inventory)
    (
      (SELECT v FROM ga4_vin) IS NOT NULL
      AND (SELECT v FROM inv_vin) IS NOT NULL
      AND (SELECT v FROM ga4_vin) = (SELECT v FROM inv_vin)
    )
    OR
    -- Legacy: full inventory URL contains GA4 page_path (hoot + aligned paths)
    (
      p_page_path IS NOT NULL
      AND btrim(p_page_path) <> ''
      AND p_inv_url IS NOT NULL
      AND btrim(p_inv_url) <> ''
      AND lower(btrim(p_inv_url)) LIKE '%' || lower(btrim(p_page_path)) || '%'
    );
$$;

GRANT EXECUTE ON FUNCTION public.inventory_matches_ga4_page_path(text, text, text)
  TO anon, authenticated, service_role;
