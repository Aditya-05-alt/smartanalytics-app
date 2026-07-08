-- Inventory report: location breakdown from smart_hoot_inventory.
-- Single report date (snapshot as of p_report_date). Deploy in Supabase SQL editor.

DROP FUNCTION IF EXISTS public.loc_inv_breakdown(
  text, date, text[], text[], text[], text[], integer[], text
);

CREATE OR REPLACE FUNCTION public.loc_inv_breakdown(
  p_client_id    text,
  p_report_date  date,
  p_types        text[] DEFAULT NULL,
  p_makes        text[] DEFAULT NULL,
  p_models       text[] DEFAULT NULL,
  p_locations    text[] DEFAULT NULL,
  p_years        integer[] DEFAULT NULL,
  p_condition    text DEFAULT 'BOTH'
)
RETURNS TABLE (
  location_bucket text,
  units           bigint,
  total_value     numeric,
  pct             numeric,
  rank            int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH dealer AS (
    SELECT h.customer_name
    FROM public.smart_hoot_config h
    WHERE trim(h.ga4_customer_id::text) = trim(p_client_id)
      AND COALESCE(h.is_active, true) = true
    ORDER BY h.id DESC
    LIMIT 1
  ),
  base AS (
    SELECT
      COALESCE(NULLIF(TRIM(i.location), ''), 'Unknown') AS location_bucket,
      COALESCE(i.price, 0)::numeric AS price
    FROM public.smart_hoot_inventory i
    CROSS JOIN dealer d
    WHERE (
        trim(COALESCE(i.customer_name, '')) = trim(d.customer_name)
        OR trim(COALESCE(i.advertiser, '')) = trim(d.customer_name)
        OR trim(COALESCE(i.customer_name, '')) ILIKE trim(d.customer_name) || '%'
        OR trim(d.customer_name) ILIKE trim(COALESCE(i.customer_name, '')) || '%'
      )
      AND COALESCE(i.first_seen, i.last_seen, now())::date <= p_report_date
      AND (
        i.last_seen IS NULL
        OR i.last_seen::date >= p_report_date
      )
      AND (COALESCE(array_length(p_types, 1), 0) = 0 OR i.type_ = ANY(p_types))
      AND (COALESCE(array_length(p_makes, 1), 0) = 0 OR i.make = ANY(p_makes))
      AND (COALESCE(array_length(p_models, 1), 0) = 0 OR i.model = ANY(p_models))
      AND (
        COALESCE(array_length(p_locations, 1), 0) = 0
        OR TRIM(i.location) = ANY(SELECT TRIM(loc) FROM unnest(p_locations) AS loc)
      )
      AND (
        COALESCE(array_length(p_years, 1), 0) = 0
        OR (i.year ~ '^\d{4}$' AND i.year::int = ANY(p_years))
      )
      AND (
        UPPER(COALESCE(p_condition, 'BOTH')) = 'BOTH'
        OR (
          UPPER(p_condition) = 'NEW'
          AND i.condition ILIKE 'new%'
        )
        OR (
          UPPER(p_condition) = 'USED'
          AND (i.condition ILIKE 'used%' OR i.condition ILIKE 'pre%')
        )
      )
  ),
  agg AS (
    SELECT
      location_bucket,
      COUNT(*)::bigint AS units,
      COALESCE(SUM(price), 0)::numeric AS total_value
    FROM base
    GROUP BY location_bucket
  ),
  ranked AS (
    SELECT
      *,
      ROW_NUMBER() OVER (ORDER BY units DESC, location_bucket) AS rn
    FROM agg
  ),
  grand AS (
    SELECT NULLIF(SUM(units), 0)::numeric AS total_units FROM ranked
  )
  SELECT
    r.location_bucket,
    r.units,
    r.total_value,
    ROUND(100.0 * r.units / g.total_units, 2) AS pct,
    r.rn::int AS rank
  FROM ranked r
  CROSS JOIN grand g
  ORDER BY r.rn;
$$;

GRANT EXECUTE ON FUNCTION public.loc_inv_breakdown(
  text, date, text[], text[], text[], text[], integer[], text
) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.loc_inv_breakdown IS
  'Inventory report location breakdown as of a single report date.';
