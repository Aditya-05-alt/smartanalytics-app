-- Admin pipeline Step 2: exact date-range filtration on smart_ga4_page_data.
-- Cron / edge jobs keep using apply_vdp_filtration(p_client_id, p_days_back).

DROP FUNCTION IF EXISTS public.apply_vdp_filtration_range(text, date, date);

CREATE OR REPLACE FUNCTION public.apply_vdp_filtration_range(
  p_client_id text DEFAULT NULL,
  p_from      date  DEFAULT NULL,
  p_to        date  DEFAULT NULL
)
RETURNS TABLE(out_account_name text, out_cms text, out_updated_rows bigint)
LANGUAGE plpgsql
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
    AND (p_client_id IS NULL OR g.client_id = p_client_id);

  RETURN QUERY
  WITH updated_data AS (
    UPDATE smart_ga4_page_data g
    SET
      vdp_conditions = (g.page_path ~* sl.vdp_logic),

      ga4_page_type = CASE
        WHEN g.page_path ~* sl.vdp_logic THEN 'VDP'
        WHEN sl.home_page_logic IS NOT NULL AND sl.home_page_logic <> ''
             AND LOWER(sl.home_page_logic) NOT IN ('true','false')
             AND g.page_path ~* sl.home_page_logic THEN 'Home page'
        WHEN sl.srp_logic IS NOT NULL AND sl.srp_logic <> ''
             AND LOWER(sl.srp_logic) NOT IN ('true','false')
             AND g.page_path ~* sl.srp_logic THEN 'SRP'
        ELSE 'Other Page'
      END,

      vdp_vehicle_condition = CASE
        WHEN g.page_path ~* sl.vdp_logic THEN
          CASE
            WHEN g.page_path ILIKE '%new%'  THEN 'New'
            WHEN g.page_path ILIKE '%used%' THEN 'Used'
            ELSE NULL
          END
        ELSE NULL
      END,

      year = CASE
        WHEN g.page_path ~* sl.vdp_logic AND g.page_path ~* '\d{4}'
        THEN SUBSTRING(g.page_path FROM '(\d{4})')::INTEGER
        ELSE NULL
      END

    FROM smart_vdp_logic sl
    WHERE g.report_date BETWEEN p_from AND p_to
      AND g.client_id = sl.dealer_id
      AND sl.vdp_logic IS NOT NULL
      AND sl.vdp_logic <> ''
      AND LOWER(sl.vdp_logic) NOT IN ('true','false')
      AND LENGTH(sl.vdp_logic) >= 5
      AND (p_client_id IS NULL OR g.client_id = p_client_id)
    RETURNING g.account_name, g.cms
  )
  SELECT updated_data.account_name, updated_data.cms, COUNT(*)::bigint
  FROM updated_data
  GROUP BY updated_data.account_name, updated_data.cms;
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_vdp_filtration_range(text, date, date)
  TO anon, authenticated, service_role;
