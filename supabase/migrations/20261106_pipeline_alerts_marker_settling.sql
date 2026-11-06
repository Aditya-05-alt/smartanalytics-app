-- GA4 writes smart_ga4_day_complete ~3 days after the day, but data is loaded, filtered and
-- built into Final well before that. A fully processed day missing only the marker is
-- 'pending' (Settling) for 2 extra days instead of a 'ga4_incomplete' error.
-- Full definition: supabase/rpc/get_pipeline_alerts.sql

DO $patch$
DECLARE
  d text;
  a1 text := $a$WHEN g.completed_at IS NULL THEN 'GA4 sync started but never completed (' || g.page_rows || ' rows, no completion marker)'$a$;
  r1 text := $r$WHEN g.completed_at IS NULL AND g.unfiltered_rows = 0 AND g.vdp_rows > 0 AND g.final_rows > 0
          THEN 'GA4 data loaded and built into Final (' || g.final_rows || ' final rows); waiting for GA4 day-complete marker'
        WHEN g.completed_at IS NULL THEN 'GA4 sync started but never completed (' || g.page_rows || ' rows, no completion marker)'$r$;
  a2 text := $a$WHEN c.report_date > v_settled_through THEN 'pending'$a$;
  r2 text := $r$WHEN c.report_date > v_settled_through THEN 'pending'
        -- GA4 writes the day-complete marker ~3 days later; a fully processed day is still settling.
        WHEN c.code = 'ga4_incomplete' AND c.unfiltered_rows = 0 AND c.vdp_rows > 0 AND c.final_rows > 0
             AND c.report_date >= v_settled_through - 2 THEN 'pending'$r$;
BEGIN
  d := pg_get_functiondef('public.get_pipeline_alerts(date,date,integer,integer[])'::regprocedure);
  IF position('waiting for GA4 day-complete marker' in d) > 0 THEN RETURN; END IF;
  IF (length(d) - length(replace(d, a1, ''))) / length(a1) <> 1 THEN RAISE EXCEPTION 'message anchor not found once'; END IF;
  IF (length(d) - length(replace(d, a2, ''))) / length(a2) <> 1 THEN RAISE EXCEPTION 'severity anchor not found once'; END IF;
  EXECUTE replace(replace(d, a1, r1), a2, r2);
END
$patch$;

-- The GA4 sync writes no marker for a day GA4 returned nothing for. If the sync has run
-- since that day, report "no GA4 data" (warning) instead of "sync did not run" (error).
DO $patch$
DECLARE
  d text;
  a1 text := $a$WHEN g.completed_at IS NULL AND g.page_rows = 0 THEN 'ga4_not_synced'$a$;
  r1 text := $r$WHEN g.completed_at IS NULL AND g.page_rows = 0
             AND (SELECT gc.last_fetched_at FROM smart_ga4_config gc WHERE gc.client_id = g.cid AND gc.is_active LIMIT 1) >= g.report_date + 1
          THEN 'ga4_empty'
        WHEN g.completed_at IS NULL AND g.page_rows = 0 THEN 'ga4_not_synced'$r$;
  a2 text := $a$WHEN g.completed_at IS NULL AND g.page_rows = 0 THEN 'GA4 sync did not run'$a$;
  r2 text := $r$WHEN g.completed_at IS NULL AND g.page_rows = 0
             AND (SELECT gc.last_fetched_at FROM smart_ga4_config gc WHERE gc.client_id = g.cid AND gc.is_active LIMIT 1) >= g.report_date + 1
          THEN 'GA4 sync ran but GA4 returned no data for this day - check the website''s GA4 tag'
        WHEN g.completed_at IS NULL AND g.page_rows = 0 THEN 'GA4 sync did not run'$r$;
BEGIN
  d := pg_get_functiondef('public.get_pipeline_alerts(date,date,integer,integer[])'::regprocedure);
  IF position('GA4 sync ran but GA4 returned no data' in d) > 0 THEN RETURN; END IF;
  IF (length(d) - length(replace(d, a1, ''))) / length(a1) <> 1 THEN RAISE EXCEPTION 'code anchor not found once'; END IF;
  IF (length(d) - length(replace(d, a2, ''))) / length(a2) <> 1 THEN RAISE EXCEPTION 'message anchor not found once'; END IF;
  EXECUTE replace(replace(d, a1, r1), a2, r2);
END
$patch$;

-- Krenek RV (group 34 is killed by the edge CPU limit before reaching it every run).
UPDATE smart_ga4_config SET sync_group = 24 WHERE client_id = '4914417019' AND sync_group = 34;

-- Redline Powersports (Dealer Spike, no inventory feed): Logic-only VDP logic.
UPDATE smart_vdp_logic SET
  cms = 'Dealer Spike',
  vdp_logic = '^/(new|used|pre-?owned)-inventory-.+-\d+(\?.*)?$ OR ^/--xInventoryDetail OR ^/inventory/v1/Current/.+---\d+ OR [?&]page=xInventoryDetail',
  srp_logic = '^/.*--x?(all|new|preowned)?inventory(\?.*)?$',
  home_page_logic = '^/$',
  data_source = 'Logic',
  updated_at = now()
WHERE dealer_id IN ('5712913774', '4568026047', '7084352568', '2505143058') AND vdp_logic IS NULL;
