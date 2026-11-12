-- Event Tracking follow-up.
-- 1. Some dealers run two GA4 properties and their form tracking lives in the other one
--    (Moix, Zoomers). events_property_id overrides ga4_property_id for the form-events sync only;
--    VDP / page data keep using ga4_property_id.
-- 2. GTM names that are not "<form>_submit": text after the token ("quote_request_submit - Unit
--    Detail", "pre_qualify_submitied") and "<form>_form" completions on the Harley-Davidson sites
--    ("confirm_availability_form", "contact_us_page_form").

ALTER TABLE public.smart_ga4_config ADD COLUMN IF NOT EXISTS events_property_id text;

UPDATE public.smart_ga4_config SET events_property_id = '386520680' WHERE client_id = '488499138';
UPDATE public.smart_ga4_config SET events_property_id = '533090648' WHERE client_id = '5691491478';

INSERT INTO public.smart_event_form_aliases (form, common_form) VALUES
  ('confirm_availability', 'check_availability_submit'),
  ('i_am_interested', 'lowest_price_submit')
ON CONFLICT (form) DO UPDATE SET common_form = EXCLUDED.common_form;

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

  SELECT m[1] INTO v_token
  FROM regexp_matches(v_name, '([a-z0-9_&]+_submit)', 'g') WITH ORDINALITY AS t(m, n)
  ORDER BY n DESC
  LIMIT 1;
  IF v_token IS NULL THEN
    -- "<form>_form" completion events (no "_submit" at all).
    v_token := substring(btrim(v_name) FROM '^([a-z0-9_&]+_form)$');
    IF v_token IS NULL OR v_token = 'form' THEN
      RETURN NULL;
    END IF;
    v_token := v_token || '_submit';
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
