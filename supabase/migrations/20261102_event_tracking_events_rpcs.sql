-- Form events for the Event Tracking dashboard, read from smart_events_data
-- (filled by the smart-ga4-events edge function).

-- 1) Per event type, for the dealer table and dealer x event matrix.
CREATE OR REPLACE FUNCTION public.get_event_tracking_event_totals(
  p_client_id text,
  p_from date,
  p_to date
)
RETURNS TABLE (
  event_name text,
  event_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '55s'
AS $$
  SELECT
    e.event_name,
    COALESCE(SUM(e.event_count), 0)::bigint AS event_count
  FROM public.smart_events_data e
  WHERE e.client_id::text = btrim(p_client_id)
    AND e.report_date BETWEEN p_from AND p_to
  GROUP BY e.event_name
  ORDER BY e.event_name;
$$;

-- 2) Per channel and event type, for the channel table, event x channel matrix and details.
CREATE OR REPLACE FUNCTION public.get_event_tracking_event_channel_totals(
  p_client_id text,
  p_from date,
  p_to date
)
RETURNS TABLE (
  channel text,
  event_name text,
  event_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '55s'
AS $$
  SELECT
    COALESCE(NULLIF(btrim(e.channel), ''), 'unassigned') AS channel,
    e.event_name,
    COALESCE(SUM(e.event_count), 0)::bigint AS event_count
  FROM public.smart_events_data e
  WHERE e.client_id::text = btrim(p_client_id)
    AND e.report_date BETWEEN p_from AND p_to
  GROUP BY 1, e.event_name
  ORDER BY 1, e.event_name;
$$;

REVOKE ALL ON FUNCTION public.get_event_tracking_event_totals(text, date, date)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_event_tracking_event_channel_totals(text, date, date)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_event_tracking_event_totals(text, date, date)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.get_event_tracking_event_channel_totals(text, date, date)
  TO service_role;
