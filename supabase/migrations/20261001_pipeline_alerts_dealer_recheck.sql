-- Per-dealer re-check for admin pipeline alerts.
-- Requires get_pipeline_alerts(date, date, integer, integer[]) from supabase/rpc/get_pipeline_alerts.sql.
-- Recomputes alerts only for p_dealer_ids over the latest snapshot's date range and patches that
-- snapshot in place. Alerts that no longer reproduce move to payload.resolved (shown as "Fixed")
-- until the next full refresh.

CREATE OR REPLACE FUNCTION public.recheck_pipeline_alerts_dealers(
  p_dealer_ids integer[],
  p_triggered_by text DEFAULT 'admin'
)
RETURNS public.smart_pipeline_alert_snapshots
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.smart_pipeline_alert_snapshots;
  v_fresh jsonb;
  v_now timestamptz := now();
  v_by text := COALESCE(NULLIF(btrim(p_triggered_by), ''), 'admin');
  v_alerts jsonb;
  v_resolved jsonb;
  v_rechecked jsonb;
  v_dealers jsonb;
BEGIN
  IF p_dealer_ids IS NULL OR cardinality(p_dealer_ids) = 0 THEN
    RAISE EXCEPTION 'p_dealer_ids is required';
  END IF;

  SELECT * INTO v_row
  FROM public.smart_pipeline_alert_snapshots
  ORDER BY generated_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN public.refresh_pipeline_alerts(NULL, NULL, v_by);
  END IF;

  v_fresh := public.get_pipeline_alerts(
    v_row.from_date, v_row.to_date,
    COALESCE((v_row.payload->>'settleDays')::int, 2),
    p_dealer_ids);

  SELECT COALESCE(jsonb_agg(d ORDER BY d->>'dealerName'), '[]'::jsonb)
  INTO v_dealers
  FROM (
    SELECT d FROM jsonb_array_elements(COALESCE(v_row.payload->'dealers', '[]'::jsonb)) d
    WHERE NOT ((d->>'dealerId')::int = ANY (p_dealer_ids))
    UNION ALL
    SELECT d FROM jsonb_array_elements(v_fresh->'dealers') d
  ) s;

  -- Old alerts for other dealers + fresh alerts for the re-checked dealers.
  SELECT COALESCE(jsonb_agg(a ORDER BY a->>'dealerName', a->>'reportDate'), '[]'::jsonb)
  INTO v_alerts
  FROM (
    SELECT a FROM jsonb_array_elements(v_row.payload->'alerts') a
    WHERE NOT ((a->>'dealerId')::int = ANY (p_dealer_ids))
    UNION ALL
    SELECT a FROM jsonb_array_elements(v_fresh->'alerts') a
  ) s;

  -- Previously resolved items stay unless they failed again; newly cleared alerts are added.
  SELECT COALESCE(jsonb_agg(r ORDER BY r->>'resolvedAt' DESC, r->>'dealerName'), '[]'::jsonb)
  INTO v_resolved
  FROM (
    SELECT r FROM jsonb_array_elements(COALESCE(v_row.payload->'resolved', '[]'::jsonb)) r
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_fresh->'alerts') f
      WHERE f->>'dealerId' = r->>'dealerId'
        AND f->>'reportDate' IS NOT DISTINCT FROM r->>'reportDate'
    )
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_row.payload->'alerts') o
      WHERE (o->>'dealerId')::int = ANY (p_dealer_ids)
        AND o->>'dealerId' = r->>'dealerId'
        AND o->>'reportDate' IS NOT DISTINCT FROM r->>'reportDate'
    )
    UNION ALL
    SELECT o || jsonb_build_object('resolvedAt', v_now, 'resolvedBy', v_by)
    FROM jsonb_array_elements(v_row.payload->'alerts') o
    WHERE (o->>'dealerId')::int = ANY (p_dealer_ids)
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_fresh->'alerts') f
        WHERE f->>'dealerId' = o->>'dealerId'
          AND f->>'reportDate' IS NOT DISTINCT FROM o->>'reportDate'
      )
  ) s;

  SELECT COALESCE(v_row.payload->'recheckedDealers', '{}'::jsonb)
         || COALESCE(jsonb_object_agg(d::text, v_now), '{}'::jsonb)
  INTO v_rechecked
  FROM unnest(p_dealer_ids) d;

  UPDATE public.smart_pipeline_alert_snapshots s
  SET payload = v_row.payload
        || jsonb_build_object(
             'alerts', v_alerts,
             'dealers', v_dealers,
             'resolved', v_resolved,
             'recheckedDealers', v_rechecked,
             'lastDealerRecheckAt', v_now,
             'unmappedClients', v_fresh->'unmappedClients',
             'cronFailures', v_fresh->'cronFailures'),
      error_count = (SELECT count(*) FROM jsonb_array_elements(v_alerts) a WHERE a->>'severity' = 'error')
        + jsonb_array_length(v_fresh->'cronFailures'),
      warning_count = (SELECT count(*) FROM jsonb_array_elements(v_alerts) a WHERE a->>'severity' = 'warning')
        + jsonb_array_length(v_fresh->'unmappedClients'),
      pending_count = (SELECT count(*) FROM jsonb_array_elements(v_alerts) a WHERE a->>'severity' = 'pending')
  WHERE s.id = v_row.id
  RETURNING s.* INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.recheck_pipeline_alerts_dealers(integer[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recheck_pipeline_alerts_dealers(integer[], text) TO service_role;
