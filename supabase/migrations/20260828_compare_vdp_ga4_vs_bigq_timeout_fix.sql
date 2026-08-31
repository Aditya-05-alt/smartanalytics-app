-- Speed up VDP GA4 vs BigQ compare: partial index for vdp_conditions scans by date+property.
-- Also redeploy optimized compare_vdp_ga4_vs_bigq (no full BigQ title MODE, no final_data scan).

CREATE INDEX IF NOT EXISTS idx_ga4_page_vdp_date_prop
  ON public.smart_ga4_page_data (report_date, ga4_property_id)
  INCLUDE (views)
  WHERE vdp_conditions IS TRUE;
