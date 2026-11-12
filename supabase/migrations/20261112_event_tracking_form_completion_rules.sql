-- Event Tracking: tighten which non-"_submit" GA4 events count as form submissions.
--  * "<x>_submitted ..." (e.g. textmealink_submitted) is a widget, not a site form -> ignored.
--  * "<x>_form" counts only when it is a completion: complete_/confirm_/submit_ prefix or
--    "_page_form" suffix (Harley-Davidson sites). start_/view_ and generic names (web_form) don't.
--  * Completion "_form" events count only for dealers that send no "_submit" form events at all,
--    because sites that have both fire them for the same submission.

CREATE OR REPLACE FUNCTION public.event_tracking_common_form(p_event_name text)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_name text;
  v_token text;
  v_base text;
  v_hit text;
BEGIN
  v_name := lower(regexp_replace(COALESCE(p_event_name, ''), '([a-z0-9])([A-Z])', '\1_\2', 'g'));
  v_name := regexp_replace(v_name, '[a-z0-9_&]*_submitted\S*', ' ', 'g');

  SELECT m[1] INTO v_token
  FROM regexp_matches(v_name, '([a-z0-9_&]+_submit)', 'g') WITH ORDINALITY AS t(m, n)
  ORDER BY n DESC
  LIMIT 1;
  IF v_token IS NULL THEN
    v_name := btrim(v_name);
    IF v_name !~ '^(complete|confirm|submit)_[a-z0-9_&]+_form$' AND v_name !~ '^[a-z0-9_&]+_page_form$' THEN
      RETURN NULL;
    END IF;
    v_token := regexp_replace(v_name, '^(complete|submit)_', '') || '_submit';
  END IF;

  v_token := regexp_replace(replace(v_token, '&', '_'), '_+', '_', 'g');
  IF v_token = 'form_submit' THEN
    RETURN NULL;
  END IF;

  v_base := regexp_replace(v_token, '_submit$', '');
  SELECT common_form INTO v_hit FROM public.smart_event_form_aliases WHERE form = v_base;
  IF v_hit IS NOT NULL THEN RETURN v_hit; END IF;

  v_base := regexp_replace(v_base, '(_(page|form))+$', '');
  SELECT common_form INTO v_hit FROM public.smart_event_form_aliases WHERE form = v_base;
  IF v_hit IS NOT NULL THEN RETURN v_hit; END IF;

  SELECT common_form INTO v_hit FROM public.smart_event_form_aliases
  WHERE v_base LIKE replace(form, '_', '\_') || '\_%'
  ORDER BY length(form) DESC LIMIT 1;
  IF v_hit IS NOT NULL THEN RETURN v_hit; END IF;

  SELECT common_form INTO v_hit FROM public.smart_event_form_aliases
  WHERE position(form IN v_base) > 0
  ORDER BY length(form) DESC LIMIT 1;
  RETURN COALESCE(v_hit, 'other_form_submit');
END;
$$;

-- Raw events that count for the dashboard: mapped, and not a "_form" completion from a dealer
-- that already sends "_submit" events.
CREATE OR REPLACE VIEW public.v_event_tracking_form_events AS
WITH mapped AS (
  SELECT e.*,
         public.event_tracking_common_form(e.event_name) AS common_form,
         lower(e.event_name) ~ '_submit' AS is_submit_event
  FROM public.smart_events_data e
),
submit_dealers AS (
  SELECT DISTINCT client_id FROM mapped WHERE common_form IS NOT NULL AND is_submit_event
)
SELECT m.*
FROM mapped m
WHERE m.common_form IS NOT NULL
  AND (m.is_submit_event OR m.client_id NOT IN (SELECT client_id FROM submit_dealers));
REVOKE ALL ON public.v_event_tracking_form_events FROM anon, authenticated;

DROP MATERIALIZED VIEW IF EXISTS public.mv_event_tracking_events_daily;
CREATE MATERIALIZED VIEW public.mv_event_tracking_events_daily AS
SELECT f.client_id,
       f.report_date,
       public.event_tracking_channel_name(f.channel) AS channel,
       f.common_form AS event_name,
       SUM(f.event_count) AS event_count
FROM public.v_event_tracking_form_events f
GROUP BY f.client_id, f.report_date, public.event_tracking_channel_name(f.channel), f.common_form;

CREATE UNIQUE INDEX mv_event_tracking_events_daily_key
  ON public.mv_event_tracking_events_daily (client_id, report_date, channel, event_name);
REVOKE ALL ON public.mv_event_tracking_events_daily FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_event_tracking_event_totals(p_client_id text, p_from date, p_to date)
RETURNS TABLE(event_name text, event_count bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '55s'
AS $function$
  SELECT f.common_form, COALESCE(SUM(f.event_count), 0)::bigint
  FROM public.v_event_tracking_form_events f
  WHERE f.client_id::text = btrim(p_client_id)
    AND f.report_date BETWEEN p_from AND p_to
  GROUP BY 1
  ORDER BY 1;
$function$;

CREATE OR REPLACE FUNCTION public.get_event_tracking_event_channel_totals(p_client_id text, p_from date, p_to date)
RETURNS TABLE(channel text, event_name text, event_count bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '55s'
AS $function$
  SELECT COALESCE(NULLIF(btrim(f.channel), ''), 'unassigned'), f.common_form, COALESCE(SUM(f.event_count), 0)::bigint
  FROM public.v_event_tracking_form_events f
  WHERE f.client_id::text = btrim(p_client_id)
    AND f.report_date BETWEEN p_from AND p_to
  GROUP BY 1, 2
  ORDER BY 1, 2;
$function$;
