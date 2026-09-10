-- Align all VDP inventory breakdown totals to get_vdp_views_total (same filters).
-- Why totals diverged (esp. 2025 / early 2026):
--   Channel + unfiltered KPI → smart_ga4_page_data (vdp_conditions)
--   Location/Year/Condition/Make/Model/Type → smart_final_data (often incomplete vs GA4)
-- Fix: keep Final bucket mix, scale Σ buckets to KPI target (GA4 when unfiltered,
-- Final when inventory-filtered). Applies to all dealers.

CREATE OR REPLACE FUNCTION public.vdp_scale_breakdown_to_kpi(
  p_buckets text[],
  p_views bigint[],
  p_ranks int[],
  p_target bigint
)
RETURNS TABLE (
  bucket text,
  views bigint,
  pct numeric,
  rank int
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n int;
  i int;
  v_raw bigint := 0;
  v_scaled bigint[];
  v_sum bigint := 0;
  v_max_i int := 1;
  v_target bigint := COALESCE(p_target, 0);
BEGIN
  n := COALESCE(array_length(p_buckets, 1), 0);
  IF n = 0 THEN
    IF v_target > 0 THEN
      bucket := 'Other';
      views := v_target;
      pct := 100.0;
      rank := 1;
      RETURN NEXT;
    END IF;
    RETURN;
  END IF;

  IF COALESCE(array_length(p_views, 1), 0) <> n
     OR COALESCE(array_length(p_ranks, 1), 0) <> n THEN
    RAISE EXCEPTION 'vdp_scale_breakdown_to_kpi: array length mismatch';
  END IF;

  FOR i IN 1..n LOOP
    v_raw := v_raw + COALESCE(p_views[i], 0);
  END LOOP;

  v_scaled := array_fill(0::bigint, ARRAY[n]);

  IF v_raw <= 0 THEN
    IF v_target > 0 THEN
      bucket := 'Other';
      views := v_target;
      pct := 100.0;
      rank := 1;
      RETURN NEXT;
    END IF;
    RETURN;
  END IF;

  IF v_target <= 0 THEN
    RETURN;
  END IF;

  FOR i IN 1..n LOOP
    v_scaled[i] := ROUND(
      COALESCE(p_views[i], 0)::numeric * v_target::numeric / v_raw::numeric
    )::bigint;
    v_sum := v_sum + v_scaled[i];
    IF v_scaled[i] > v_scaled[v_max_i]
       OR (v_scaled[i] = v_scaled[v_max_i] AND p_buckets[i] < p_buckets[v_max_i]) THEN
      v_max_i := i;
    END IF;
  END LOOP;

  -- Absorb ROUND drift on largest bucket
  v_scaled[v_max_i] := v_scaled[v_max_i] + (v_target - v_sum);

  FOR i IN 1..n LOOP
    IF v_scaled[i] > 0 THEN
      bucket := p_buckets[i];
      views := v_scaled[i];
      pct := ROUND(100.0 * v_scaled[i]::numeric / v_target::numeric, 2);
      rank := p_ranks[i];
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.vdp_scale_breakdown_to_kpi(text[], bigint[], int[], bigint) IS
  'Scale breakdown bucket views so SUM equals KPI target (get_vdp_views_total).';

GRANT EXECUTE ON FUNCTION public.vdp_scale_breakdown_to_kpi(text[], bigint[], int[], bigint)
  TO anon, authenticated, service_role;
