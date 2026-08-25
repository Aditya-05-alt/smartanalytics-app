-- Remove pre-property overloads that collide with p_ga4_property_id versions.
-- When both exist, PostgREST cannot resolve get_year_breakdown / get_condition_breakdown
-- for dealers that omit p_ga4_property_id.

DROP FUNCTION IF EXISTS public.get_year_breakdown(
  text, date, date, int, text[], text[], text[], text[], integer[], text, text[]
);

DROP FUNCTION IF EXISTS public.get_condition_breakdown(
  text, date, date, int, text[], text[], text[], text[], integer[], text, text[]
);
