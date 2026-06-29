-- Helper: true when page_path matches any OR-separated VDP regex in smart_vdp_logic.vdp_logic.
-- Deploy before apply_vdp_filtration_range when using multiple VDP patterns in the admin UI.

CREATE OR REPLACE FUNCTION public.page_path_matches_vdp_logic(
  p_page_path text,
  p_vdp_logic text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT bool_or(p_page_path ~* btrim(pat))
      FROM unnest(
        regexp_split_to_array(COALESCE(p_vdp_logic, ''), E'\\s+OR\\s+', 'i')
      ) AS pat
      WHERE btrim(pat) <> ''
        AND lower(btrim(pat)) NOT IN ('true', 'false')
        AND length(btrim(pat)) >= 5
    ),
    false
  );
$$;

GRANT EXECUTE ON FUNCTION public.page_path_matches_vdp_logic(text, text)
  TO anon, authenticated, service_role;
