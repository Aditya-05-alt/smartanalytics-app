-- Cron / edge Step 2: apply_vdp_filtration(p_client_id, p_days_back).
-- Requires page_path_matches_vdp_logic.sql for multiple VDP patterns (OR-separated).
--
-- Drop legacy 1-arg overload if present:
DROP FUNCTION IF EXISTS public.apply_vdp_filtration(text);

CREATE OR REPLACE FUNCTION public.apply_vdp_filtration(
  p_client_id text DEFAULT NULL,
  p_days_back integer DEFAULT NULL
)
RETURNS TABLE(out_account_name text, out_cms text, out_updated_rows bigint)
LANGUAGE plpgsql
AS $$
BEGIN
  -- STEP 1: Self-heal CMS
  UPDATE smart_ga4_page_data g
  SET cms = h.website_platform
  FROM smart_hoot_config h
  WHERE g.report_date >= (CURRENT_DATE - p_days_back)
    AND (g.cms IS NULL OR g.cms = '')
    AND g.client_id = h.ga4_customer_id::text
    AND (p_client_id IS NULL OR g.client_id = p_client_id);

  -- STEP 2: Dealer-by-dealer classification
  RETURN QUERY
  WITH updated_data AS (
    UPDATE smart_ga4_page_data g
    SET
      vdp_conditions = public.page_path_matches_vdp_logic(g.page_path, sl.vdp_logic),

      ga4_page_type = CASE
        WHEN public.page_path_matches_vdp_logic(g.page_path, sl.vdp_logic) THEN 'VDP'
        WHEN sl.home_page_logic IS NOT NULL AND sl.home_page_logic <> ''
             AND LOWER(sl.home_page_logic) NOT IN ('true','false')
             AND g.page_path ~* sl.home_page_logic THEN 'Home page'
        WHEN sl.srp_logic IS NOT NULL AND sl.srp_logic <> ''
             AND LOWER(sl.srp_logic) NOT IN ('true','false')
             AND g.page_path ~* sl.srp_logic THEN 'SRP'
        ELSE 'Other Page'
      END,

      vdp_vehicle_condition = CASE
        WHEN public.page_path_matches_vdp_logic(g.page_path, sl.vdp_logic) THEN
          CASE
            WHEN g.page_path ILIKE '%new%'  THEN 'New'
            WHEN g.page_path ILIKE '%used%' THEN 'Used'
            ELSE NULL
          END
        ELSE NULL
      END,

      year = CASE
        WHEN public.page_path_matches_vdp_logic(g.page_path, sl.vdp_logic)
             AND g.page_path ~* '\d{4}'
        THEN SUBSTRING(g.page_path FROM '(\d{4})')::INTEGER
        ELSE NULL
      END

    FROM smart_vdp_logic sl
    WHERE g.report_date >= (CURRENT_DATE - p_days_back)
      AND g.client_id = sl.dealer_id
      AND sl.vdp_logic IS NOT NULL
      AND sl.vdp_logic <> ''
      AND EXISTS (
        SELECT 1
        FROM unnest(
          regexp_split_to_array(sl.vdp_logic, E'\\s+OR\\s+', 'i')
        ) AS pat
        WHERE btrim(pat) <> ''
          AND lower(btrim(pat)) NOT IN ('true', 'false')
          AND length(btrim(pat)) >= 5
      )
      AND (p_client_id IS NULL OR g.client_id = p_client_id)
    RETURNING g.account_name, g.cms
  )
  SELECT updated_data.account_name, updated_data.cms, COUNT(*)::bigint
  FROM updated_data
  GROUP BY updated_data.account_name, updated_data.cms;
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_vdp_filtration(text, integer)
  TO anon, authenticated, service_role;
