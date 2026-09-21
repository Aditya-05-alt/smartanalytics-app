-- Seed the notebook from fixes that already exist in smart_final_data.
-- APPLIED 2026-09-17, after 20260917_logic2_notebook_prepare.sql. Seeded 7,570
-- entries across 71 dealers (the 30-day estimate below was ~10,394).
--
-- Without this the notebook starts empty and only earns its keep gradually, as Logic 2
-- happens to re-encounter each URL. Seeding makes the replay useful from the first run.
--
-- What counts as a Logic 2 fix
--   A row that is VDP-flagged with a resolved inv_url and make, but has NO matching
--   inventory record (inv_sk IS NULL). Step 3 could not have produced that on its own,
--   so it is exactly the state that disappears on the next rebuild. Restricted further
--   to paths matching the dealer's own smart_vdp_logic_2 pattern, which is Logic 2's
--   actual domain.
--
-- Sizing measured 2026-09-17: 83 dealers hold a Logic 2 pattern, and ~10,394 distinct
-- paths over the last 30 days carry this signature. The lookback is deliberately 30
-- days rather than the full history so the notebook records URLs that are still live,
-- not every VDP ever published.

BEGIN;

INSERT INTO public.smart_unknown_vdp_links (
  client_id, ga4_property_id, account_name, report_date,
  page_path, page_location, page_title, views, cms,
  status, matched_vdp_logic, fix_source,
  inv_url, inv_condition, inv_year, inv_make, inv_model,
  inv_type, inv_custom_type, inv_stock_number
)
SELECT DISTINCT ON (f.client_id, f.page_path)
  f.client_id,
  f.ga4_property_id,
  f.account_name,
  f.report_date,            -- most recent date this URL was seen, metadata only
  f.page_path,
  f.page_location,
  f.page_title,
  f.views,                  -- snapshot for context; the replay never writes it back
  f.cms,
  'matched',
  l.vdp_logic,
  'backfill',
  f.inv_url,
  f.inv_condition,
  f.inv_year,
  f.inv_make,
  f.inv_model,
  f.inv_type,
  f.inv_custom_type,
  f.inv_stock_number
FROM public.smart_final_data f
JOIN public.smart_vdp_logic_2 l
  ON l.dealer_id = f.client_id
 AND NULLIF(btrim(l.vdp_logic), '') IS NOT NULL
WHERE f.report_date >= CURRENT_DATE - 30
  AND f.vdp_conditions IS TRUE
  AND f.inv_sk IS NULL
  AND NULLIF(btrim(f.inv_url), '') IS NOT NULL
  AND NULLIF(btrim(f.inv_make), '') IS NOT NULL
  AND lower(btrim(f.inv_make)) NOT IN ('unknown', 'other')
  AND public.page_path_matches_vdp_logic(f.page_path, l.vdp_logic)
ORDER BY f.client_id, f.page_path, f.report_date DESC
ON CONFLICT (client_id, page_path) DO UPDATE
SET status           = 'matched',
    fix_source       = 'backfill',
    report_date      = EXCLUDED.report_date,
    page_location    = COALESCE(EXCLUDED.page_location, public.smart_unknown_vdp_links.page_location),
    page_title       = COALESCE(EXCLUDED.page_title, public.smart_unknown_vdp_links.page_title),
    cms              = COALESCE(EXCLUDED.cms, public.smart_unknown_vdp_links.cms),
    matched_vdp_logic = EXCLUDED.matched_vdp_logic,
    inv_url          = EXCLUDED.inv_url,
    inv_condition    = EXCLUDED.inv_condition,
    inv_year         = EXCLUDED.inv_year,
    inv_make         = EXCLUDED.inv_make,
    inv_model        = EXCLUDED.inv_model,
    inv_type         = EXCLUDED.inv_type,
    inv_custom_type  = EXCLUDED.inv_custom_type,
    inv_stock_number = EXCLUDED.inv_stock_number,
    updated_at       = now();

COMMIT;

-- Post-seed sanity check (read-only, safe to run separately):
--
--   SELECT fix_source, status, COUNT(*) AS entries, COUNT(DISTINCT client_id) AS dealers
--   FROM public.smart_unknown_vdp_links
--   GROUP BY fix_source, status ORDER BY entries DESC;
--
-- Then dry-run the replay against a single dealer over a narrow range and confirm
-- final_rows_repaired looks plausible before scheduling anything:
--
--   SELECT public.apply_logic2_notebook_replay('<client_id>', CURRENT_DATE - 3, CURRENT_DATE);
