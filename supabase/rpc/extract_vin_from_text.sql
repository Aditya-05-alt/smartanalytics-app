-- Extract 17-char VIN from page_path, inventory URL, or vin column text.
-- Deploy before inventory_matches_ga4_page_path.sql and build_smart_final_data_scrap.sql.

CREATE OR REPLACE FUNCTION public.extract_vin_from_text(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT NULLIF(
    upper(substring(COALESCE(p_text, '') from '([A-HJ-NPR-Z0-9]{17})(?:/?(?:\?.*)?$)')),
    ''
  );
$$;

GRANT EXECUTE ON FUNCTION public.extract_vin_from_text(text)
  TO anon, authenticated, service_role;
