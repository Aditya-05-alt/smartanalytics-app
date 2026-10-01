-- Admin pipeline alerts.
-- get_pipeline_alerts() is defined in supabase/rpc/get_pipeline_alerts.sql. Counting GA4 rows
-- for a 3-day window cold-reads ~160k heap pages (~1 min), so the admin UI reads the latest
-- snapshot row instead; pg_cron refreshes it after the nightly pipeline and the admin
-- "Re-check now" button calls refresh_pipeline_alerts() on demand.

CREATE TABLE IF NOT EXISTS public.smart_pipeline_alert_snapshots (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  generated_at timestamptz NOT NULL DEFAULT now(),
  from_date date NOT NULL,
  to_date date NOT NULL,
  triggered_by text NOT NULL DEFAULT 'cron',
  error_count integer NOT NULL DEFAULT 0,
  warning_count integer NOT NULL DEFAULT 0,
  pending_count integer NOT NULL DEFAULT 0,
  payload jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS smart_pipeline_alert_snapshots_generated_idx
  ON public.smart_pipeline_alert_snapshots (generated_at DESC);

ALTER TABLE public.smart_pipeline_alert_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.smart_pipeline_alert_snapshots FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.refresh_pipeline_alerts(
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL,
  p_triggered_by text DEFAULT 'cron'
)
RETURNS public.smart_pipeline_alert_snapshots
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payload jsonb;
  v_row public.smart_pipeline_alert_snapshots;
BEGIN
  v_payload := public.get_pipeline_alerts(p_from, p_to);

  INSERT INTO public.smart_pipeline_alert_snapshots
    (from_date, to_date, triggered_by, error_count, warning_count, pending_count, payload)
  SELECT
    (v_payload->>'from')::date,
    (v_payload->>'to')::date,
    COALESCE(NULLIF(btrim(p_triggered_by), ''), 'cron'),
    count(*) FILTER (WHERE a->>'severity' = 'error')
      + jsonb_array_length(v_payload->'cronFailures'),
    count(*) FILTER (WHERE a->>'severity' = 'warning')
      + jsonb_array_length(v_payload->'unmappedClients'),
    count(*) FILTER (WHERE a->>'severity' = 'pending'),
    v_payload
  FROM (SELECT 1) one
  LEFT JOIN LATERAL jsonb_array_elements(v_payload->'alerts') a ON true
  RETURNING * INTO v_row;

  DELETE FROM public.smart_pipeline_alert_snapshots
  WHERE generated_at < now() - interval '30 days';

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_pipeline_alerts(date, date, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_pipeline_alerts(date, date, text) TO service_role;

SELECT cron.schedule(
  'pipeline-alerts-refresh',
  '30 6,12 * * *',
  $cron$
  SET statement_timeout TO '900000';
  SELECT public.refresh_pipeline_alerts(NULL, NULL, 'cron');
  $cron$
);
