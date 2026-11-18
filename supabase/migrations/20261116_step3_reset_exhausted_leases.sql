-- When a Step 3 worker is killed (gateway timeout) before finish_step3_dealer runs,
-- the row stays status=running with attempts at the max. Reclaim was blocked forever
-- that night (Jay's Power Center QS). Reset exhausted expired leases so the next
-- worker can continue from resume_day.
CREATE OR REPLACE FUNCTION public.claim_step3_dealer(
  p_kind text,
  p_client_ids text[],
  p_worker text DEFAULT NULL,
  p_lease_seconds integer DEFAULT 300,
  p_max_attempts integer DEFAULT 4
)
RETURNS TABLE(client_id text, attempts integer, resume_day date)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_run date := (now() AT TIME ZONE 'utc')::date;
BEGIN
  INSERT INTO smart_step3_runs (run_date, client_id, kind)
  SELECT v_run, c, p_kind
  FROM unnest(p_client_ids) AS c
  ON CONFLICT DO NOTHING;

  UPDATE smart_step3_runs r
  SET status = 'pending', attempts = 0, resume_day = NULL, updated_at = now()
  WHERE r.run_date = v_run
    AND r.kind = p_kind
    AND r.status = 'done'
    AND EXISTS (
      SELECT 1 FROM smart_ga4_day_complete d
      WHERE d.client_id = r.client_id
        AND d.report_date >= v_run - 8
        AND d.completed_at > r.finished_at
    );

  -- Gateway kills leave running + attempts at max with an expired lease; reopen them.
  UPDATE smart_step3_runs r
  SET status = 'pending', attempts = 0, lease_until = NULL, worker = NULL, updated_at = now()
  WHERE r.run_date = v_run
    AND r.kind = p_kind
    AND r.status = 'running'
    AND r.lease_until < now()
    AND r.attempts >= p_max_attempts;

  RETURN QUERY
  WITH nxt AS (
    SELECT r.client_id
    FROM smart_step3_runs r
    WHERE r.run_date = v_run
      AND r.kind = p_kind
      AND r.client_id = ANY (p_client_ids)
      AND r.attempts < p_max_attempts
      AND (
        r.status IN ('pending', 'error')
        OR (r.status = 'running' AND r.lease_until < now())
      )
    ORDER BY r.attempts, r.client_id
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  UPDATE smart_step3_runs r
  SET status      = 'running',
      attempts    = r.attempts + 1,
      lease_until = now() + make_interval(secs => p_lease_seconds),
      started_at  = now(),
      worker      = p_worker,
      updated_at  = now()
  FROM nxt
  WHERE r.run_date = v_run
    AND r.client_id = nxt.client_id
  RETURNING r.client_id, r.attempts, r.resume_day;
END;
$function$;
