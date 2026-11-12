/**
 * Event Tracking: map raw GA4 form events to 13 common forms (always "<form>_submit").
 * The database applies the same rules (event_tracking_common_form + smart_event_form_aliases);
 * keep both in sync.
 *
 * Rules, in order:
 *  1. camelCase -> snake_case, lowercase, drop "..._submitted" widget events, keep the last
 *     "..._submit" token ("Label | x_submit" -> "x_submit"). Without one, only completion events
 *     "complete_|confirm_|submit_..._form" or "..._page_form" count (as "..._form_submit").
 *     The database also ignores those completion events for dealers that send "_submit" events.
 *  2. GA4's own "form_submit" (fires on any form, incl. search) is not a dealer form -> null.
 *  3. Known form name or alias -> its common form.
 *  4. Strip "form"/"page" words before the suffix (x_form_submit -> x_submit) and look up again.
 *  5. xyza -> xyz: the longest known form name the event starts with.
 *  6. The longest known form name contained in the event.
 *  7. Anything else -> other_form_submit.
 */

/** Common form -> the form names (from the GA4 form-tracking sheet) it absorbs, without "_submit". */
export const COMMON_FORMS = {
  contact_us_submit: [
    'contact_us', 'contact_widget', 'get_in_touch', 'popup_contact', 'questions', 'ask_us',
    'ask_question', 'product_help', 'contact_form', 'contact', 'get_price_alert_contact_form',
  ],
  request_info_submit: [
    'request_info', 'contact_sales', 'more_info', 'sales_lead', 'request_model', 'brochure_request',
    'inquiry_form', 'inquiry',
  ],
  check_availability_submit: ['check_availability', 'confirm_availability'],
  quote_request_submit: ['quote_request', 'get_quote', 'getquote', 'request_price', 'price_request'],
  lowest_price_submit: [
    'lowest_price', 'best_price', 'unlock_price', 'e_price', 'eprice', 'popup_offer', 'claim_offer',
    'promotions', 'i_am_interested',
  ],
  make_offer_submit: ['make_offer', 'buy_now', 'reserve_now', 'deposit'],
  trade_value_submit: [
    'trade_value', 'trade_in', 'trade_evaluation', 'sell_bike', 'sell_unit', 'consignment',
  ],
  financing_submit: [
    'financing', 'financing_request', 'credit_app', 'pre_qualify', 'payment_calc',
    'payment_calculator', 'payment_options',
  ],
  test_drive_submit: [
    'test_drive', 'test_ride', 'schedule_visit', 'schedule_viewing', 'schedule_appointment',
    'sales_appt', 'video_chat', 'virtual_tour',
  ],
  service_submit: [
    'service', 'service_request', 'service_appointment', 'service_appt', 'service_inquiry',
    'service_lead',
  ],
  parts_submit: ['parts', 'parts_request', 'parts_inquiry', 'parts_lead'],
  custom_form_submit: ['custom_form', 'embedded_form', 'motomate_lead'],
  other_form_submit: [
    'other_form', 'other_lead', 'send_to_friend', 'newsletter', 'review', 'careers', 'employment',
    'accessibility_request', 'donation_request', 'guest_feedback', 'rental_inquiry',
    'rental_request', 'storage_request', 'tow_rating', 'insurance_quote', 'shipping_quote',
    'library_inquiry', 'warranty_request', 'unit_finder', 'unit_request', 'shopper_guide',
    'vehicle_alert', 'price_alert', 'price_drop_alert',
  ],
};

export const COMMON_FORM_NAMES = Object.keys(COMMON_FORMS);

/** GA4 enhanced-measurement event, not a dealer form. */
const IGNORED = new Set(['form_submit']);

const FORM_TO_COMMON = new Map(
  Object.entries(COMMON_FORMS).flatMap(([common, forms]) => forms.map((form) => [form, common]))
);
/** Longest first, so "payment_calculator" wins over "payment_calc" and "parts_request" over "parts". */
const KNOWN_FORMS = [...FORM_TO_COMMON.keys()].sort((a, b) => b.length - a.length);

function lookup(base) {
  return FORM_TO_COMMON.get(base) || null;
}

/** Raw GA4 event name -> common form ("..._submit"), or null for events that are not dealer forms. */
export function commonFormFor(rawEventName) {
  const lowered = String(rawEventName || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[a-z0-9_&]*_submitted\S*/g, ' ');
  const tokens = lowered.match(/[a-z0-9_&]+_submit/g);
  let token = tokens?.[tokens.length - 1];
  if (!token) {
    const trimmed = lowered.trim();
    if (!/^(complete|confirm|submit)_[a-z0-9_&]+_form$/.test(trimmed) && !/^[a-z0-9_&]+_page_form$/.test(trimmed)) {
      return null;
    }
    token = `${trimmed.replace(/^(complete|submit)_/, '')}_submit`;
  }
  const name = token.replace(/&/g, '_').replace(/_+/g, '_');
  if (IGNORED.has(name)) return null;

  let base = name.replace(/_submit$/, '');
  const direct = lookup(base);
  if (direct) return direct;

  base = base.replace(/(_(page|form))+$/, '');
  const stripped = lookup(base);
  if (stripped) return stripped;

  const prefix = KNOWN_FORMS.find((form) => base.startsWith(`${form}_`));
  if (prefix) return FORM_TO_COMMON.get(prefix);

  const contained = KNOWN_FORMS.find((form) => base.includes(form));
  if (contained) return FORM_TO_COMMON.get(contained);

  return 'other_form_submit';
}
