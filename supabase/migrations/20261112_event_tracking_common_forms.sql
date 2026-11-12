-- Event Tracking: group every raw GA4 "..._submit" event into 13 common forms.
-- smart_events_data keeps the raw GA4 event name; the daily MV and the per-dealer RPCs report
-- the common form. Same rules as src/lib/eventTracking/formMapping.js:
--   1. camelCase -> snake_case, lowercase, keep the last "..._submit" token.
--   2. GA4's own form_submit (fires on any form, incl. search) is not a dealer form -> NULL.
--   3. Known form name or alias -> its common form.
--   4. Strip trailing "_form"/"_page" and look up again.
--   5. Longest known form the name starts with, then the longest known form it contains.
--   6. Anything else -> other_form_submit.

CREATE TABLE IF NOT EXISTS public.smart_event_form_aliases (
  form        text PRIMARY KEY,
  common_form text NOT NULL
);
ALTER TABLE public.smart_event_form_aliases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.smart_event_form_aliases FROM anon, authenticated;

INSERT INTO public.smart_event_form_aliases (form, common_form)
SELECT f, c || '_submit'
FROM (VALUES
  ('contact_us', ARRAY['contact_us', 'contact_widget', 'get_in_touch', 'popup_contact', 'questions', 'ask_us',
    'ask_question', 'product_help', 'contact_form', 'contact', 'get_price_alert_contact_form']),
  ('request_info', ARRAY['request_info', 'contact_sales', 'more_info', 'sales_lead', 'request_model',
    'brochure_request', 'inquiry_form', 'inquiry']),
  ('check_availability', ARRAY['check_availability']),
  ('quote_request', ARRAY['quote_request', 'get_quote', 'getquote', 'request_price', 'price_request']),
  ('lowest_price', ARRAY['lowest_price', 'best_price', 'unlock_price', 'e_price', 'eprice', 'popup_offer',
    'claim_offer', 'promotions']),
  ('make_offer', ARRAY['make_offer', 'buy_now', 'reserve_now', 'deposit']),
  ('trade_value', ARRAY['trade_value', 'trade_in', 'trade_evaluation', 'sell_bike', 'sell_unit', 'consignment']),
  ('financing', ARRAY['financing', 'financing_request', 'credit_app', 'pre_qualify', 'payment_calc',
    'payment_calculator', 'payment_options']),
  ('test_drive', ARRAY['test_drive', 'test_ride', 'schedule_visit', 'schedule_viewing', 'schedule_appointment',
    'sales_appt', 'video_chat', 'virtual_tour']),
  ('service', ARRAY['service', 'service_request', 'service_appointment', 'service_appt', 'service_inquiry',
    'service_lead']),
  ('parts', ARRAY['parts', 'parts_request', 'parts_inquiry', 'parts_lead']),
  ('custom_form', ARRAY['custom_form', 'embedded_form', 'motomate_lead']),
  ('other_form', ARRAY['other_form', 'other_lead', 'send_to_friend', 'newsletter', 'review', 'careers',
    'employment', 'accessibility_request', 'donation_request', 'guest_feedback', 'rental_inquiry',
    'rental_request', 'storage_request', 'tow_rating', 'insurance_quote', 'shipping_quote', 'library_inquiry',
    'warranty_request', 'unit_finder', 'unit_request', 'shopper_guide', 'vehicle_alert', 'price_alert',
    'price_drop_alert'])
) v(c, forms), unnest(v.forms) AS f
ON CONFLICT (form) DO UPDATE SET common_form = EXCLUDED.common_form;

CREATE OR REPLACE FUNCTION public.event_tracking_common_form(p_event_name text)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_token text;
  v_base text;
  v_hit text;
BEGIN
  SELECT m[1] INTO v_token
  FROM regexp_matches(
    lower(regexp_replace(COALESCE(p_event_name, ''), '([a-z0-9])([A-Z])', '\1_\2', 'g')),
    '([a-z0-9_&]+_submit)', 'g'
  ) WITH ORDINALITY AS t(m, n)
  ORDER BY n DESC
  LIMIT 1;
  IF v_token IS NULL THEN
    RETURN NULL;
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

DROP MATERIALIZED VIEW IF EXISTS public.mv_event_tracking_events_daily;
CREATE MATERIALIZED VIEW public.mv_event_tracking_events_daily AS
SELECT e.client_id,
       e.report_date,
       public.event_tracking_channel_name(e.channel) AS channel,
       m.common_form AS event_name,
       SUM(e.event_count) AS event_count
FROM public.smart_events_data e
CROSS JOIN LATERAL (SELECT public.event_tracking_common_form(e.event_name) AS common_form) m
WHERE m.common_form IS NOT NULL
GROUP BY e.client_id, e.report_date, public.event_tracking_channel_name(e.channel), m.common_form;

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
  SELECT
    public.event_tracking_common_form(e.event_name) AS event_name,
    COALESCE(SUM(e.event_count), 0)::bigint AS event_count
  FROM public.smart_events_data e
  WHERE e.client_id::text = btrim(p_client_id)
    AND e.report_date BETWEEN p_from AND p_to
    AND public.event_tracking_common_form(e.event_name) IS NOT NULL
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
  SELECT
    COALESCE(NULLIF(btrim(e.channel), ''), 'unassigned') AS channel,
    public.event_tracking_common_form(e.event_name) AS event_name,
    COALESCE(SUM(e.event_count), 0)::bigint AS event_count
  FROM public.smart_events_data e
  WHERE e.client_id::text = btrim(p_client_id)
    AND e.report_date BETWEEN p_from AND p_to
    AND public.event_tracking_common_form(e.event_name) IS NOT NULL
  GROUP BY 1, 2
  ORDER BY 1, 2;
$function$;

REVOKE ALL ON FUNCTION public.event_tracking_common_form(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_tracking_common_form(text) TO service_role;
