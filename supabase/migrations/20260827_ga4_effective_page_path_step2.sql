-- Use page_path_q_s for VDP/inventory matching when populated (Destination Cycle).
-- Falls back to page_path for all other dealers.

CREATE OR REPLACE FUNCTION public.ga4_effective_page_path(
  p_page_path text,
  p_page_path_q_s text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT COALESCE(NULLIF(TRIM(p_page_path_q_s), ''), NULLIF(TRIM(p_page_path), ''));
$$;

GRANT EXECUTE ON FUNCTION public.ga4_effective_page_path(text, text)
  TO anon, authenticated, service_role;

-- Destination Cycle: add default.asp InventoryDetail pattern for page_path_q_s matching.
UPDATE public.smart_vdp_logic
SET
  vdp_logic = '/(?:New|Pre-?owned)-Inventory-.+-\d+ OR /inventory/v1/Current/.+---\d+ OR /default\.asp\?.*InventoryDetail.*id=\d+',
  updated_at = now()
WHERE dealer_id = '1421445735';

-- Step 2: apply_vdp_filtration_range uses ga4_effective_page_path for VDP logic.
CREATE OR REPLACE FUNCTION public.apply_vdp_filtration_range(
  p_client_id text DEFAULT NULL,
  p_from      date  DEFAULT NULL,
  p_to        date  DEFAULT NULL
)
RETURNS TABLE(out_account_name text, out_cms text, out_updated_rows bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_from IS NULL OR p_to IS NULL THEN
    RAISE EXCEPTION 'p_from and p_to are required';
  END IF;

  UPDATE smart_ga4_page_data g
  SET cms = h.website_platform
  FROM smart_hoot_config h
  WHERE g.report_date BETWEEN p_from AND p_to
    AND (g.cms IS NULL OR g.cms = '')
    AND g.client_id = h.ga4_customer_id::text
    AND public.ga4_property_scope_matches(g.ga4_property_id, h.ga4_property_id)
    AND (p_client_id IS NULL OR g.client_id = p_client_id);

  RETURN QUERY
  WITH updated_data AS (
    UPDATE smart_ga4_page_data g
    SET
      vdp_conditions = public.page_path_matches_vdp_logic(
        public.ga4_effective_page_path(g.page_path, g.page_path_q_s),
        sl.vdp_logic
      ),

      ga4_page_type = CASE
        WHEN public.page_path_matches_vdp_logic(
          public.ga4_effective_page_path(g.page_path, g.page_path_q_s),
          sl.vdp_logic
        ) THEN 'VDP'
        WHEN sl.home_page_logic IS NOT NULL AND sl.home_page_logic <> ''
             AND LOWER(sl.home_page_logic) NOT IN ('true','false')
             AND g.page_path ~* sl.home_page_logic THEN 'Home page'
        WHEN sl.srp_logic IS NOT NULL AND sl.srp_logic <> ''
             AND LOWER(sl.srp_logic) NOT IN ('true','false')
             AND g.page_path ~* sl.srp_logic THEN 'SRP'
        ELSE 'Other Page'
      END,

      vdp_vehicle_condition = CASE
        WHEN public.page_path_matches_vdp_logic(
          public.ga4_effective_page_path(g.page_path, g.page_path_q_s),
          sl.vdp_logic
        ) THEN
          CASE
            WHEN public.ga4_effective_page_path(g.page_path, g.page_path_q_s) ILIKE '%new%' THEN 'New'
            WHEN public.ga4_effective_page_path(g.page_path, g.page_path_q_s) ILIKE '%used%'
              OR public.ga4_effective_page_path(g.page_path, g.page_path_q_s) ILIKE '%preowned%' THEN 'Used'
            ELSE NULL
          END
        ELSE NULL
      END,

      year = CASE
        WHEN public.page_path_matches_vdp_logic(
          public.ga4_effective_page_path(g.page_path, g.page_path_q_s),
          sl.vdp_logic
        )
             AND public.ga4_effective_page_path(g.page_path, g.page_path_q_s) ~* '\d{4}'
        THEN SUBSTRING(public.ga4_effective_page_path(g.page_path, g.page_path_q_s) FROM '(\d{4})')::INTEGER
        ELSE NULL
      END

    FROM smart_vdp_logic sl
    WHERE g.report_date BETWEEN p_from AND p_to
      AND g.client_id = sl.dealer_id
      AND public.ga4_property_scope_matches(g.ga4_property_id, sl.ga4_property_id)
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

REVOKE ALL ON FUNCTION public.apply_vdp_filtration_range(text, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_vdp_filtration_range(text, date, date)
  TO service_role;
