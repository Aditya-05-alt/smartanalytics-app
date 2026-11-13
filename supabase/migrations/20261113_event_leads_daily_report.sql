-- Daily Event Tracking leads email (edge function event-leads-daily-report), one per report day.

CREATE TABLE IF NOT EXISTS public.smart_event_leads_report_log (
  report_date date PRIMARY KEY,
  sent_at timestamptz,
  recipients text[],
  dealers integer,
  leads bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.smart_event_leads_report_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.smart_event_leads_report_log FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.smart_event_leads_report_log TO service_role;

/** Leads (counted form events) per active dealer for p_date, the day before, the last 7 days and month to date. */
CREATE OR REPLACE FUNCTION public.get_event_leads_daily_report(p_date date)
RETURNS TABLE(client_id text, dealer_name text, has_forms boolean, day_leads bigint, prev_day bigint,
              last7 bigint, mtd bigint, forms jsonb)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH d AS (
    SELECT c.client_id::text AS client_id, max(c.account_name) AS dealer_name
    FROM public.smart_ga4_config c
    WHERE c.is_active
    GROUP BY 1
  ), e AS (
    SELECT m.client_id, m.report_date, m.event_name, SUM(m.event_count)::bigint AS n
    FROM public.mv_event_tracking_events_daily m
    WHERE m.report_date BETWEEN LEAST(p_date - 6, date_trunc('month', p_date)::date) AND p_date
    GROUP BY 1, 2, 3
  ), f AS (
    SELECT x.client_id, jsonb_agg(jsonb_build_object('form', x.event_name, 'n', x.n) ORDER BY x.n DESC, x.event_name) AS forms
    FROM (SELECT client_id, event_name, SUM(n) AS n FROM e WHERE report_date = p_date GROUP BY 1, 2) x
    GROUP BY 1
  )
  SELECT d.client_id, d.dealer_name,
         EXISTS (SELECT 1 FROM public.smart_event_form_aliases a WHERE a.client_id = d.client_id AND a.is_counted),
         COALESCE(SUM(e.n) FILTER (WHERE e.report_date = p_date), 0)::bigint,
         COALESCE(SUM(e.n) FILTER (WHERE e.report_date = p_date - 1), 0)::bigint,
         COALESCE(SUM(e.n) FILTER (WHERE e.report_date BETWEEN p_date - 6 AND p_date), 0)::bigint,
         COALESCE(SUM(e.n) FILTER (WHERE e.report_date >= date_trunc('month', p_date)::date), 0)::bigint,
         COALESCE(f.forms, '[]'::jsonb)
  FROM d
  LEFT JOIN e ON e.client_id = d.client_id
  LEFT JOIN f ON f.client_id = d.client_id
  GROUP BY d.client_id, d.dealer_name, f.forms
  ORDER BY 4 DESC, 2;
$function$;

REVOKE ALL ON FUNCTION public.get_event_leads_daily_report(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_event_leads_daily_report(date) TO service_role;

-- 01:50 UTC (07:20 IST), after the 01:00–01:39 smart-ga4-events sync. Public anon key only;
-- the function sends once per day and returns no lead data.
SELECT cron.schedule('event-leads-daily-report', '50 1 * * *', $c$
SELECT net.http_post(
  url := 'https://rllwmeqingvuohyctddg.supabase.co/functions/v1/event-leads-daily-report',
  headers := jsonb_build_object('Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJsbHdtZXFpbmd2dW9oeWN0ZGRnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwNjUzODAsImV4cCI6MjA5MTY0MTM4MH0.xv-dC78Yp_1nQFBQCD5AJ9-wRalJuWMToo3erQNBbcU', 'Content-Type', 'application/json'),
  body := '{}'::jsonb,
  timeout_milliseconds := 120000
);
$c$);
