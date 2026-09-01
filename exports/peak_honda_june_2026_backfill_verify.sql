-- Verify Peak Honda June unknowns after backfill
SELECT
  COUNT(*) FILTER (
    WHERE (inv_url IS NULL OR btrim(inv_url) = '')
      AND COALESCE(vdp_conditions, false) IS NOT TRUE
  ) AS still_unknown_vdp_false,
  COUNT(*) FILTER (
    WHERE inv_condition IS NULL OR btrim(inv_condition) = ''
  ) AS blank_condition,
  COUNT(*) FILTER (WHERE vdp_conditions IS TRUE AND inv_make IS NOT NULL) AS filled_vdp,
  SUM(views) FILTER (
    WHERE vdp_conditions IS TRUE
      AND inv_condition IS NOT NULL
      AND report_date BETWEEN '2026-06-01' AND '2026-06-30'
  ) AS views_with_condition
FROM public.smart_final_data
WHERE client_id = '2721177227'
  AND report_date BETWEEN '2026-06-01' AND '2026-06-30';
