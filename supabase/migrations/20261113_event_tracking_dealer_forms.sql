-- Every GA4 form is registered to the dealer it fires on, so a group (e.g. contact_us_submit) is
-- that dealer's form 1 + form 2 + ... and never another dealer's forms.
--
-- smart_event_form_aliases now holds two kinds of rows:
--   client_id NULL     shared naming rule (form = name stem, e.g. 'contact_us' -> contact_us_submit)
--   client_id set      that dealer's own GA4 form (form = raw event name), counted only for that dealer
-- smart_events_data.common_form is stamped from the dealer rows; NULL = not counted.

ALTER TABLE public.smart_event_form_aliases DROP CONSTRAINT IF EXISTS smart_event_form_aliases_pkey;
ALTER TABLE public.smart_event_form_aliases
  ADD COLUMN IF NOT EXISTS id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ADD COLUMN IF NOT EXISTS client_id text,
  ADD COLUMN IF NOT EXISTS dealer_name text,
  ADD COLUMN IF NOT EXISTS is_counted boolean,
  ADD COLUMN IF NOT EXISTS first_seen date,
  ADD COLUMN IF NOT EXISTS last_seen date,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS smart_event_form_aliases_rule_key
  ON public.smart_event_form_aliases (form) WHERE client_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS smart_event_form_aliases_dealer_key
  ON public.smart_event_form_aliases (client_id, form) WHERE client_id IS NOT NULL;

COMMENT ON COLUMN public.smart_event_form_aliases.client_id IS
  'NULL = shared naming rule. Set = this dealer''s own GA4 form; its events count only for this dealer.';
COMMENT ON COLUMN public.smart_event_form_aliases.is_counted IS
  'Dealer rows: false for "_form" completion events of dealers that also fire "_submit" events.';

ALTER TABLE public.smart_events_data ADD COLUMN IF NOT EXISTS common_form text;
COMMENT ON COLUMN public.smart_events_data.common_form IS
  'Group this row counts toward for its dealer (from that dealer''s smart_event_form_aliases row). NULL = not counted.';
CREATE INDEX IF NOT EXISTS idx_smart_events_data_client_form
  ON public.smart_events_data (client_id, common_form, report_date) WHERE common_form IS NOT NULL;

-- Shared rules only; dealer rows are keyed by raw event name.
CREATE OR REPLACE FUNCTION public.event_tracking_common_form(p_event_name text)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
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
  SELECT common_form INTO v_hit FROM public.smart_event_form_aliases
  WHERE client_id IS NULL AND form = v_base;
  IF v_hit IS NOT NULL THEN RETURN v_hit; END IF;

  v_base := regexp_replace(v_base, '(_(page|form))+$', '');
  SELECT common_form INTO v_hit FROM public.smart_event_form_aliases
  WHERE client_id IS NULL AND form = v_base;
  IF v_hit IS NOT NULL THEN RETURN v_hit; END IF;

  SELECT common_form INTO v_hit FROM public.smart_event_form_aliases
  WHERE client_id IS NULL AND v_base LIKE replace(form, '_', '\_') || '\_%'
  ORDER BY length(form) DESC LIMIT 1;
  IF v_hit IS NOT NULL THEN RETURN v_hit; END IF;

  SELECT common_form INTO v_hit FROM public.smart_event_form_aliases
  WHERE client_id IS NULL AND position(form IN v_base) > 0
  ORDER BY length(form) DESC LIMIT 1;
  RETURN COALESCE(v_hit, 'other_form_submit');
END;
$function$;

/**
 * Registers each dealer's GA4 forms (one row per dealer + event name) and stamps
 * smart_events_data.common_form from them. A dealer row's common_form is kept once set, so a
 * form can be re-grouped for one dealer without touching the others. NULL = all dealers.
 */
CREATE OR REPLACE FUNCTION public.register_event_tracking_dealer_forms(p_client_ids text[] DEFAULT NULL)
RETURNS TABLE(registered integer, stamped integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_registered integer;
  v_stamped integer;
BEGIN
  WITH ev AS (
    SELECT e.client_id, e.event_name, max(e.account_name) AS dealer_name,
           min(e.report_date) AS first_seen, max(e.report_date) AS last_seen
    FROM public.smart_events_data e
    WHERE p_client_ids IS NULL OR e.client_id = ANY (p_client_ids)
    GROUP BY 1, 2
  ), mapped AS (
    SELECT ev.*, COALESCE(a.common_form, public.event_tracking_common_form(ev.event_name)) AS common_form,
           lower(ev.event_name) ~ '_submit' AS is_submit
    FROM ev
    LEFT JOIN public.smart_event_form_aliases a ON a.client_id = ev.client_id AND a.form = ev.event_name
  ), submit_dealers AS (
    SELECT DISTINCT client_id FROM mapped WHERE common_form IS NOT NULL AND is_submit
  )
  INSERT INTO public.smart_event_form_aliases (client_id, dealer_name, form, common_form, is_counted, first_seen, last_seen)
  SELECT m.client_id, m.dealer_name, m.event_name, m.common_form,
         m.is_submit OR m.client_id NOT IN (SELECT client_id FROM submit_dealers),
         m.first_seen, m.last_seen
  FROM mapped m
  WHERE m.common_form IS NOT NULL
  ON CONFLICT (client_id, form) WHERE client_id IS NOT NULL DO UPDATE
    SET dealer_name = EXCLUDED.dealer_name,
        is_counted = EXCLUDED.is_counted,
        first_seen = LEAST(public.smart_event_form_aliases.first_seen, EXCLUDED.first_seen),
        last_seen = GREATEST(public.smart_event_form_aliases.last_seen, EXCLUDED.last_seen),
        updated_at = now();
  GET DIAGNOSTICS v_registered = ROW_COUNT;

  UPDATE public.smart_events_data e
  SET common_form = s.common_form
  FROM (
    SELECT e2.id, CASE WHEN a.is_counted THEN a.common_form END AS common_form
    FROM public.smart_events_data e2
    LEFT JOIN public.smart_event_form_aliases a ON a.client_id = e2.client_id AND a.form = e2.event_name
    WHERE p_client_ids IS NULL OR e2.client_id = ANY (p_client_ids)
  ) s
  WHERE e.id = s.id AND e.common_form IS DISTINCT FROM s.common_form;
  GET DIAGNOSTICS v_stamped = ROW_COUNT;

  RETURN QUERY SELECT v_registered, v_stamped;
END;
$function$;

REVOKE ALL ON FUNCTION public.register_event_tracking_dealer_forms(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_event_tracking_dealer_forms(text[]) TO service_role;

-- Counted rows are the stamped ones; same columns as before.
CREATE OR REPLACE VIEW public.v_event_tracking_form_events AS
SELECT e.id, e.client_id, e.ga4_property_id, e.account_name, e.report_date, e.event_name,
       e.page_location, e.page_path, e.channel, e.source, e.medium, e.source_medium,
       e.session_campaign, e.event_count, e.total_users, e.created_at,
       e.common_form,
       lower(e.event_name) ~ '_submit' AS is_submit_event
FROM public.smart_events_data e
WHERE e.common_form IS NOT NULL;

CREATE OR REPLACE FUNCTION public.refresh_event_tracking_events_mv()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.register_event_tracking_dealer_forms(NULL);
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_event_tracking_events_daily;
END;
$function$;

-- kind 'form' rows: the dealer's own forms behind each group (event_name = group, form_name = GA4 form).
DROP FUNCTION IF EXISTS public.get_event_tracking_dashboard(date, date, text[]);
CREATE FUNCTION public.get_event_tracking_dashboard(p_from date, p_to date, p_client_ids text[] DEFAULT NULL)
RETURNS TABLE(client_id text, kind text, channel text, event_name text, value bigint, form_name text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT * FROM (
    SELECT u.client_id, 'users'::text AS kind,
           CASE WHEN u.channel = '(all)' THEN '(all)' ELSE public.event_tracking_channel_name(u.channel) END AS channel,
           NULL::text AS event_name, SUM(u.total_users)::bigint AS value, NULL::text AS form_name
    FROM public.smart_events_users u
    WHERE u.period_from = p_from AND u.period_to = p_to
      AND (p_client_ids IS NULL OR u.client_id = ANY (p_client_ids))
    GROUP BY 1, 3
    UNION ALL
    SELECT v.client_id, 'vdp', v.channel, NULL::text, SUM(v.final_views)::bigint, NULL::text
    FROM public.smart_event_tracking_vdp_daily v
    WHERE v.report_date BETWEEN p_from AND p_to
      AND (p_client_ids IS NULL OR v.client_id = ANY (p_client_ids))
    GROUP BY 1, 3
    UNION ALL
    SELECT e.client_id, 'event', e.channel, e.event_name, SUM(e.event_count)::bigint, NULL::text
    FROM public.mv_event_tracking_events_daily e
    WHERE e.report_date BETWEEN p_from AND p_to
      AND (p_client_ids IS NULL OR e.client_id = ANY (p_client_ids))
    GROUP BY 1, 3, 4
    UNION ALL
    SELECT f.client_id, 'form', public.event_tracking_channel_name(f.channel), f.common_form,
           SUM(f.event_count)::bigint, f.event_name
    FROM public.smart_events_data f
    WHERE f.common_form IS NOT NULL
      AND f.report_date BETWEEN p_from AND p_to
      AND (p_client_ids IS NULL OR f.client_id = ANY (p_client_ids))
    GROUP BY 1, 3, 4, 6
  ) r
  ORDER BY r.client_id, r.kind, r.channel, r.event_name, r.form_name;
$function$;

REVOKE ALL ON FUNCTION public.get_event_tracking_dashboard(date, date, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_event_tracking_dashboard(date, date, text[]) TO service_role;

-- Backfill: register every dealer's forms from the stored events and rebuild the daily view.
SELECT public.register_event_tracking_dealer_forms(NULL);
REFRESH MATERIALIZED VIEW public.mv_event_tracking_events_daily;
