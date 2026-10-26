-- Per-dealer Conner pipeline status for the daily Conner email.
--   feed      : today's smart_conner_inventory snapshot vs the previous snapshot
--   final VDP : GA4 VDP pages vs smart_final_data rows / matched rows for the report day
--               (GA4 for day D lands on D+1, so the report day is p_day - 1)
--   step 3    : today's smart_step3_runs row (kind = 'conner')

CREATE OR REPLACE FUNCTION public.get_conner_daily_status(
  p_day date DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')::date
)
RETURNS TABLE(
  ga4_customer_id    text,
  customer_name      text,
  website_platform   text,
  feed_rows_today    bigint,
  feed_prev_date     date,
  feed_rows_prev     bigint,
  report_date        date,
  vdp_pages          bigint,
  final_rows         bigint,
  final_matched      bigint,
  step3_status       text,
  step3_attempts     integer,
  step3_finished_at  timestamptz,
  step3_error        text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH d AS (
    SELECT * FROM public.get_conner_dealers_for_sync(NULL)
  )
  SELECT
    d.ga4_customer_id,
    d.customer_name,
    d.website_platform,
    COALESCE(today.n, 0),
    prev.update_date,
    COALESCE(prev.n, 0),
    p_day - 1,
    COALESCE(ga.pages, 0),
    COALESCE(fin.n, 0),
    COALESCE(fin.matched, 0),
    run.status,
    run.attempts,
    run.finished_at,
    run.last_error
  FROM d
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS n
    FROM public.smart_conner_inventory i
    WHERE i.customer_name = d.customer_name
      AND i.update_date = p_day
  ) today ON TRUE
  LEFT JOIN LATERAL (
    SELECT i.update_date, COUNT(*) AS n
    FROM public.smart_conner_inventory i
    WHERE i.customer_name = d.customer_name
      AND i.update_date < p_day
    GROUP BY i.update_date
    ORDER BY i.update_date DESC
    LIMIT 1
  ) prev ON TRUE
  LEFT JOIN LATERAL (
    SELECT COUNT(DISTINCT g.page_path) AS pages
    FROM public.smart_ga4_page_data g
    WHERE g.client_id = d.ga4_customer_id
      AND g.report_date = p_day - 1
      AND g.vdp_conditions IS TRUE
  ) ga ON TRUE
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS n, COUNT(f.inv_sk) AS matched
    FROM public.smart_final_data f
    WHERE f.client_id = d.ga4_customer_id
      AND f.report_date = p_day - 1
  ) fin ON TRUE
  LEFT JOIN LATERAL (
    SELECT r.status, r.attempts, r.finished_at, r.last_error
    FROM public.smart_step3_runs r
    WHERE r.client_id = d.ga4_customer_id
      AND r.run_date = p_day
      AND r.kind = 'conner'
    LIMIT 1
  ) run ON TRUE
  ORDER BY d.customer_name;
$function$;

REVOKE ALL ON FUNCTION public.get_conner_daily_status(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_conner_daily_status(date) TO service_role;
