-- Step 3 queue: per-day builds resume from the first unbuilt day.
-- Slow per-day dealers (e.g. Jay's QS at ~40s/day) cannot finish 8 days in one
-- invocation; without this they restart from day 1 every round and never finish.

ALTER TABLE public.smart_step3_runs
  ADD COLUMN IF NOT EXISTS resume_day date;

DROP FUNCTION IF EXISTS public.claim_step3_dealer(text, text[], text, integer, integer);
DROP FUNCTION IF EXISTS public.finish_step3_dealer(text, text, bigint, text, text);

CREATE FUNCTION public.claim_step3_dealer(
  p_kind           text,
  p_client_ids     text[],
  p_worker         text    DEFAULT NULL,
  p_lease_seconds  integer DEFAULT 300,
  p_max_attempts   integer DEFAULT 4
)
RETURNS TABLE (client_id text, attempts integer, resume_day date)
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

  -- GA4 re-synced after this dealer was built tonight: build it again.
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


-- p_status 'pending' releases the claim (budget ran out) without counting the attempt.
-- p_resume_day is the first day still to build; rows from a partial run accumulate.
CREATE FUNCTION public.finish_step3_dealer(
  p_client_id   text,
  p_status      text,
  p_total_rows  bigint DEFAULT NULL,
  p_error       text   DEFAULT NULL,
  p_mode        text   DEFAULT NULL,
  p_resume_day  date   DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_run date := (now() AT TIME ZONE 'utc')::date;
BEGIN
  UPDATE smart_step3_runs r
  SET status      = p_status,
      attempts    = CASE WHEN p_status = 'pending' THEN GREATEST(r.attempts - 1, 0) ELSE r.attempts END,
      finished_at = CASE WHEN p_status = 'pending' THEN r.finished_at ELSE now() END,
      lease_until = NULL,
      total_rows  = CASE
                      WHEN p_total_rows IS NULL THEN r.total_rows
                      WHEN r.resume_day IS NULL THEN p_total_rows
                      ELSE COALESCE(r.total_rows, 0) + p_total_rows
                    END,
      resume_day  = CASE
                      WHEN p_status = 'done' THEN NULL
                      ELSE COALESCE(p_resume_day, r.resume_day)
                    END,
      last_error  = CASE WHEN p_status = 'error' THEN p_error ELSE NULL END,
      mode        = COALESCE(p_mode, r.mode),
      updated_at  = now()
  WHERE r.run_date = v_run
    AND r.client_id = p_client_id;
END;
$function$;


REVOKE ALL ON FUNCTION public.claim_step3_dealer(text, text[], text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_step3_dealer(text, text, bigint, text, text, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_step3_dealer(text, text[], text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_step3_dealer(text, text, bigint, text, text, date) TO service_role;
