-- Step 3 (smart_final_data) nightly work queue.
-- Each cron invocation claims one dealer at a time instead of a fixed group,
-- so retries continue where the previous round stopped and two invocations
-- never build the same dealer at once.

CREATE TABLE IF NOT EXISTS public.smart_step3_runs (
  run_date     date        NOT NULL,
  client_id    text        NOT NULL,
  kind         text        NOT NULL DEFAULT 'hoot',
  status       text        NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'running', 'done', 'error')),
  attempts     integer     NOT NULL DEFAULT 0,
  lease_until  timestamptz,
  started_at   timestamptz,
  finished_at  timestamptz,
  total_rows   bigint,
  mode         text,
  worker       text,
  last_error   text,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_date, client_id)
);

CREATE INDEX IF NOT EXISTS smart_step3_runs_queue_idx
  ON public.smart_step3_runs (run_date, kind, status);

ALTER TABLE public.smart_step3_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.smart_step3_runs FROM anon, authenticated;
GRANT ALL ON public.smart_step3_runs TO service_role;


CREATE OR REPLACE FUNCTION public.claim_step3_dealer(
  p_kind           text,
  p_client_ids     text[],
  p_worker         text    DEFAULT NULL,
  p_lease_seconds  integer DEFAULT 300,
  p_max_attempts   integer DEFAULT 4
)
RETURNS TABLE (client_id text, attempts integer)
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
  SET status = 'pending', attempts = 0, updated_at = now()
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
  RETURNING r.client_id, r.attempts;
END;
$function$;


-- p_status 'pending' releases the claim (budget ran out) without counting the attempt.
CREATE OR REPLACE FUNCTION public.finish_step3_dealer(
  p_client_id   text,
  p_status      text,
  p_total_rows  bigint DEFAULT NULL,
  p_error       text   DEFAULT NULL,
  p_mode        text   DEFAULT NULL
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
      total_rows  = COALESCE(p_total_rows, r.total_rows),
      last_error  = CASE WHEN p_status = 'error' THEN p_error ELSE NULL END,
      mode        = COALESCE(p_mode, r.mode),
      updated_at  = now()
  WHERE r.run_date = v_run
    AND r.client_id = p_client_id;
END;
$function$;


-- True when the dealer has a VDP rule but recent GA4 rows were never tagged by Step 2.
CREATE OR REPLACE FUNCTION public.step3_needs_tagging(
  p_client_id  text,
  p_days_back  integer DEFAULT 2
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
           SELECT 1 FROM smart_vdp_logic sl
           WHERE sl.dealer_id = p_client_id
             AND COALESCE(btrim(sl.vdp_logic), '') <> ''
         )
     AND EXISTS (
           SELECT 1 FROM smart_ga4_page_data g
           WHERE g.client_id = p_client_id
             AND g.report_date >= CURRENT_DATE - p_days_back
             AND g.ga4_page_type IS NULL
         );
$function$;


REVOKE ALL ON FUNCTION public.claim_step3_dealer(text, text[], text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_step3_dealer(text, text, bigint, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.step3_needs_tagging(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_step3_dealer(text, text[], text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_step3_dealer(text, text, bigint, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.step3_needs_tagging(text, integer) TO service_role;
