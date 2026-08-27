-- Dealer Spike: match GA4 SEO slug page_paths to Hoot default.asp?id= inventory URLs (Step 3).

CREATE OR REPLACE FUNCTION public.extract_dealer_spike_listing_id_from_page_path(
  p_page_path text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (regexp_match(p_page_path, '[?&]id=(\d+)', 'i'))[1],
    (regexp_match(p_page_path, '---(\d+)$'))[1],
    CASE
      WHEN p_page_path ~* '/(?:New|Pre-?Owned)-Inventory-'
        THEN (regexp_match(p_page_path, '-(\d+)$'))[1]
      ELSE NULL
    END
  );
$$;

GRANT EXECUTE ON FUNCTION public.extract_dealer_spike_listing_id_from_page_path(text)
  TO anon, authenticated, service_role;

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
    (
      (SELECT v FROM ga4_vin) IS NOT NULL
      AND (SELECT v FROM inv_vin) IS NOT NULL
      AND (SELECT v FROM ga4_vin) = (SELECT v FROM inv_vin)
    )
    OR
    (
      public.extract_dealer_spike_listing_id_from_page_path(p_page_path) IS NOT NULL
      AND p_inv_url IS NOT NULL
      AND btrim(p_inv_url) <> ''
      AND lower(btrim(p_inv_url)) LIKE
        '%id=' || public.extract_dealer_spike_listing_id_from_page_path(p_page_path) || '%'
    )
    OR
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

-- build_smart_final_data: use inventory_matches_ga4_page_path (includes Dealer Spike id= matching)
-- See supabase/rpc/build_smart_final_data.sql for full function body deployed via apply_migration.
