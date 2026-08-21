-- Soft-match VDP condition filter (same rules as con_inv_breakdown).
-- BOTH / NULL → no filter
-- NEW → inv_condition starts with "new"
-- USED → used% / pre% / certified%

CREATE OR REPLACE FUNCTION public.vdp_condition_matches(
  p_inv_condition text,
  p_condition text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    UPPER(COALESCE(NULLIF(TRIM(p_condition), ''), 'BOTH')) = 'BOTH'
    OR (
      UPPER(TRIM(p_condition)) = 'NEW'
      AND TRIM(COALESCE(p_inv_condition, '')) ILIKE 'new%'
    )
    OR (
      UPPER(TRIM(p_condition)) = 'USED'
      AND (
        TRIM(COALESCE(p_inv_condition, '')) ILIKE 'used%'
        OR TRIM(COALESCE(p_inv_condition, '')) ILIKE 'pre%'
        OR TRIM(COALESCE(p_inv_condition, '')) ILIKE 'certified%'
      )
    );
$$;

GRANT EXECUTE ON FUNCTION public.vdp_condition_matches(text, text)
  TO anon, authenticated, service_role;
