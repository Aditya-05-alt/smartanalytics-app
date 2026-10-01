-- Admin pipeline alerts: per active dealer × day, the first pipeline step that did not finish.
--   Step 1  GA4 page sync      (smart_ga4_day_complete marker + smart_ga4_page_data rows)
--   Step 2  VDP filtration     (no vdp_conditions IS NULL rows; at least one VDP row)
--   Step 3  Final data build   (smart_final_data rows when VDP rows exist)
-- Also reports GA4 client IDs syncing without an active dealer, dealers without a GA4
-- client ID, and failed pg_cron runs in the last 24h.
-- GA4 data settles 48–72h after the day ends, so the default window ends at today - p_settle_days
-- and any later day in an explicit range is reported as "pending" instead of failed.
-- p_dealer_ids limits the check to those smart_hoot_config ids (per-dealer re-check).
-- `dealers` lists every checked dealer with its per-day status, including dealers that passed.

DROP FUNCTION IF EXISTS public.get_pipeline_alerts(date, date, time);
DROP FUNCTION IF EXISTS public.get_pipeline_alerts(date, date, time, integer[]);

CREATE OR REPLACE FUNCTION public.get_pipeline_alerts(
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL,
  p_settle_days integer DEFAULT 2,
  p_dealer_ids integer[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settled_through date := (now() AT TIME ZONE 'utc')::date - GREATEST(COALESCE(p_settle_days, 2), 0);
  v_to   date := COALESCE(p_to, v_settled_through);
  v_from date := COALESCE(p_from, v_to - 2);
  v_alerts jsonb;
  v_dealers jsonb;
  v_unmapped jsonb;
  v_cron jsonb;
BEGIN
  IF v_from > v_to THEN
    RAISE EXCEPTION 'p_from must be <= p_to';
  END IF;
  IF v_to - v_from > 31 THEN
    RAISE EXCEPTION 'Range too large (max 31 days)';
  END IF;

  WITH dealers AS (
    SELECT h.id, h.customer_name, NULLIF(btrim(h.ga4_customer_id), '') AS cid
    FROM smart_hoot_config h
    WHERE h.is_active
      AND (p_dealer_ids IS NULL OR h.id = ANY (p_dealer_ids))
  ),
  days AS (
    SELECT gs::date AS d FROM generate_series(v_from, v_to, interval '1 day') gs
  ),
  page AS (
    SELECT p.client_id, p.report_date,
           count(*) AS page_rows,
           count(*) FILTER (WHERE p.vdp_conditions IS NULL) AS unfiltered_rows,
           count(*) FILTER (WHERE p.vdp_conditions IS TRUE) AS vdp_rows
    FROM smart_ga4_page_data p
    WHERE p.report_date BETWEEN v_from AND v_to
      AND p.client_id IN (SELECT cid FROM dealers WHERE cid IS NOT NULL)
    GROUP BY 1, 2
  ),
  fin AS (
    SELECT f.client_id, f.report_date, count(*) AS final_rows
    FROM smart_final_data f
    WHERE f.report_date BETWEEN v_from AND v_to
      AND f.client_id IN (SELECT cid FROM dealers WHERE cid IS NOT NULL)
    GROUP BY 1, 2
  ),
  grid AS (
    SELECT dl.id AS dealer_id, dl.customer_name, dl.cid, dy.d AS report_date,
           c.completed_at,
           COALESCE(pg.page_rows, 0) AS page_rows,
           COALESCE(pg.unfiltered_rows, 0) AS unfiltered_rows,
           COALESCE(pg.vdp_rows, 0) AS vdp_rows,
           COALESCE(fn.final_rows, 0) AS final_rows
    FROM dealers dl
    CROSS JOIN days dy
    LEFT JOIN smart_ga4_day_complete c ON c.client_id = dl.cid AND c.report_date = dy.d
    LEFT JOIN page pg ON pg.client_id = dl.cid AND pg.report_date = dy.d
    LEFT JOIN fin fn ON fn.client_id = dl.cid AND fn.report_date = dy.d
    WHERE dl.cid IS NOT NULL
  ),
  checked AS (
    SELECT g.*,
      CASE
        WHEN g.completed_at IS NULL OR g.page_rows = 0 THEN 1
        WHEN g.unfiltered_rows > 0 THEN 2
        WHEN g.vdp_rows = 0 THEN 2
        WHEN g.final_rows = 0 THEN 3
      END AS step,
      CASE
        WHEN g.completed_at IS NULL AND g.page_rows = 0 THEN 'ga4_not_synced'
        WHEN g.completed_at IS NULL THEN 'ga4_incomplete'
        WHEN g.page_rows = 0 THEN 'ga4_empty'
        WHEN g.unfiltered_rows > 0 THEN 'filtration_incomplete'
        WHEN g.vdp_rows = 0 THEN 'filtration_no_vdp'
        WHEN g.final_rows = 0 THEN 'final_missing'
      END AS code,
      CASE
        WHEN g.completed_at IS NULL AND g.page_rows = 0 THEN 'GA4 sync did not run'
        WHEN g.completed_at IS NULL THEN 'GA4 sync started but never completed (' || g.page_rows || ' rows, no completion marker)'
        WHEN g.page_rows = 0 THEN 'GA4 sync completed with 0 page rows'
        WHEN g.unfiltered_rows > 0 THEN 'Filtration did not finish (' || g.unfiltered_rows || ' of ' || g.page_rows || ' rows unfiltered)'
        WHEN g.vdp_rows = 0 THEN 'Filtration matched 0 VDP pages (' || g.page_rows || ' page rows) — check VDP logic'
        WHEN g.final_rows = 0 THEN 'Final data not built (' || g.vdp_rows || ' VDP rows, 0 final rows)'
      END AS message
    FROM grid g
  ),
  issues AS (
    SELECT c.*,
      CASE
        WHEN c.step IS NULL THEN 'success'
        WHEN c.report_date > v_settled_through THEN 'pending'
        WHEN c.code IN ('ga4_empty', 'filtration_no_vdp') THEN 'warning'
        ELSE 'error'
      END AS severity
    FROM checked c
    UNION ALL
    SELECT dl.id, dl.customer_name, NULL::text, NULL::date, NULL::timestamptz, 0::bigint, 0::bigint, 0::bigint, 0::bigint,
           0, 'no_client_id', 'Dealer has no GA4 client ID configured', 'error'
    FROM dealers dl WHERE dl.cid IS NULL
  )
  SELECT
    (SELECT COALESCE(jsonb_agg(jsonb_build_object(
              'dealerId', x.dealer_id,
              'dealerName', x.customer_name,
              'clientId', x.cid,
              'reportDate', x.report_date,
              'step', x.step,
              'code', x.code,
              'message', x.message,
              'severity', x.severity,
              'counts', jsonb_build_object(
                 'pageRows', x.page_rows,
                 'unfilteredRows', x.unfiltered_rows,
                 'vdpRows', x.vdp_rows,
                 'finalRows', x.final_rows),
              'ga4CompletedAt', x.completed_at
            ) ORDER BY x.customer_name, x.report_date), '[]'::jsonb)
     FROM issues x WHERE x.severity <> 'success'),
    (SELECT COALESCE(jsonb_agg(d.obj ORDER BY d.customer_name), '[]'::jsonb)
     FROM (
       SELECT x.customer_name,
              jsonb_build_object(
                'dealerId', x.dealer_id,
                'dealerName', x.customer_name,
                'clientId', x.cid,
                'status', CASE
                   WHEN bool_or(x.severity = 'error') THEN 'error'
                   WHEN bool_or(x.severity = 'warning') THEN 'warning'
                   WHEN bool_or(x.severity = 'pending') THEN 'pending'
                   ELSE 'success'
                 END,
                'days', jsonb_agg(jsonb_build_object(
                   'date', x.report_date,
                   'step', x.step,
                   'code', x.code,
                   'severity', x.severity) ORDER BY x.report_date)
              ) AS obj
       FROM issues x
       GROUP BY x.dealer_id, x.customer_name, x.cid
     ) d)
  INTO v_alerts, v_dealers;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'clientId', u.client_id,
           'days', u.days,
           'lastDate', u.last_date,
           'linkedDealer', u.linked_dealer
         ) ORDER BY u.client_id), '[]'::jsonb)
  INTO v_unmapped
  FROM (
    SELECT c.client_id, count(*) AS days, max(c.report_date) AS last_date,
           (SELECT h.customer_name FROM smart_hoot_config h
             WHERE btrim(h.ga4_customer_id) = c.client_id LIMIT 1) AS linked_dealer
    FROM smart_ga4_day_complete c
    WHERE c.report_date BETWEEN v_from AND v_to
      AND NOT EXISTS (
        SELECT 1 FROM smart_hoot_config h
        WHERE h.is_active AND btrim(h.ga4_customer_id) = c.client_id
      )
    GROUP BY c.client_id
  ) u;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'jobId', r.jobid,
           'jobName', j.jobname,
           'startedAt', r.start_time,
           'message', left(r.return_message, 300)
         ) ORDER BY r.start_time DESC), '[]'::jsonb)
  INTO v_cron
  FROM cron.job_run_details r
  JOIN cron.job j ON j.jobid = r.jobid
  WHERE r.status = 'failed'
    AND r.start_time > now() - interval '24 hours';

  RETURN jsonb_build_object(
    'from', v_from,
    'to', v_to,
    'generatedAt', now(),
    'settledThrough', v_settled_through,
    'settleDays', GREATEST(COALESCE(p_settle_days, 2), 0),
    'pendingDate', CASE WHEN v_to > v_settled_through THEN v_settled_through + 1 END,
    'alerts', v_alerts,
    'dealers', v_dealers,
    'unmappedClients', v_unmapped,
    'cronFailures', v_cron
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_pipeline_alerts(date, date, integer, integer[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_pipeline_alerts(date, date, integer, integer[]) TO service_role;
