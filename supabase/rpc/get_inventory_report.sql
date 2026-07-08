-- Full Inventory Report from smart_hoot_inventory_daily.
-- One pull_date snapshot + filters. Supports single dealer OR All Dealers.
-- Units = one row per sk on that pull_date (no join duplicates).
-- Value = SUM(COALESCE(NULLIF(price,0), NULLIF(msrp,0), 0)).
-- Deploy in Supabase SQL Editor (full file).

DROP FUNCTION IF EXISTS public.get_inventory_report(
  text, date, text[], text[], text[], text[], integer[], text
);

CREATE OR REPLACE FUNCTION public.get_inventory_report(
  p_client_id    text DEFAULT NULL,          -- ga4_customer_id; NULL / '' / '__all_dealer__' = All Dealers
  p_report_date  date DEFAULT CURRENT_DATE,  -- preferred pull_date; falls back to latest available ≤ date
  p_types        text[] DEFAULT NULL,
  p_makes        text[] DEFAULT NULL,
  p_models       text[] DEFAULT NULL,
  p_locations    text[] DEFAULT NULL,
  p_years        integer[] DEFAULT NULL,
  p_condition    text DEFAULT 'BOTH'         -- BOTH | NEW | USED  (Used+New / All → BOTH)
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '55s'
AS $$
DECLARE
  v_all_dealers boolean;
  v_pull_date   date;
  v_condition   text := UPPER(TRIM(COALESCE(p_condition, 'BOTH')));
  v_result      jsonb;
BEGIN
  IF p_report_date IS NULL THEN
    RAISE EXCEPTION 'p_report_date is required';
  END IF;

  v_all_dealers := (
    p_client_id IS NULL
    OR TRIM(p_client_id) = ''
    OR TRIM(p_client_id) = '__all_dealer__'
  );

  -- Prefer exact pull_date; else nearest earlier snapshot that has configured-dealer rows.
  SELECT d.pull_date
  INTO v_pull_date
  FROM public.smart_hoot_inventory_daily d
  INNER JOIN public.smart_hoot_config h
    ON COALESCE(h.is_active, true) = true
   AND h.ga4_customer_id IS NOT NULL
   AND TRIM(h.ga4_customer_id::text) <> ''
   AND (
     TRIM(COALESCE(d.customer_name, '')) = TRIM(h.customer_name)
     OR TRIM(COALESCE(d.advertiser, '')) = TRIM(h.customer_name)
   )
  WHERE d.pull_date <= p_report_date
    AND (
      v_all_dealers
      OR TRIM(h.ga4_customer_id::text) = TRIM(p_client_id)
    )
  GROUP BY d.pull_date
  ORDER BY d.pull_date DESC
  LIMIT 1;

  IF v_pull_date IS NULL THEN
    RETURN jsonb_build_object(
      'ready', true,
      'meta', jsonb_build_object(
        'requestedDate', p_report_date,
        'pullDate', NULL,
        'clientId', NULLIF(TRIM(COALESCE(p_client_id, '')), ''),
        'allDealers', v_all_dealers,
        'source', 'smart_hoot_inventory_daily',
        'rowCount', 0,
        'message', 'No inventory snapshot on or before the requested date'
      ),
      'sections', jsonb_build_object(
        'condition', jsonb_build_object(
          'title', 'Condition', 'labelHeader', 'Conditions',
          'rows', '[]'::jsonb, 'totalUnits', 0, 'totalValue', 0
        ),
        'location', jsonb_build_object(
          'title', 'Location', 'labelHeader', 'Locations',
          'rows', '[]'::jsonb, 'totalUnits', 0, 'totalValue', 0
        ),
        'make', jsonb_build_object(
          'title', 'Make', 'labelHeader', 'Makes',
          'rows', '[]'::jsonb, 'totalUnits', 0, 'totalValue', 0
        ),
        'type', jsonb_build_object(
          'title', 'Type', 'labelHeader', 'Types',
          'rows', '[]'::jsonb, 'totalUnits', 0, 'totalValue', 0
        )
      ),
      'inventoryList', jsonb_build_object(
        'rows', '[]'::jsonb, 'totalUnits', 0, 'totalValue', 0, 'averagePrice', 0
      ),
      'filterOptions', jsonb_build_object(
        'years', '[]'::jsonb,
        'makes', '[]'::jsonb,
        'models', '[]'::jsonb,
        'types', '[]'::jsonb,
        'locations', '[]'::jsonb,
        'conditions', '[]'::jsonb
      )
    );
  END IF;

  WITH   dealers AS (
    SELECT DISTINCT ON (TRIM(h.ga4_customer_id::text))
      TRIM(h.ga4_customer_id::text) AS ga4_customer_id,
      TRIM(h.customer_name)         AS customer_name
    FROM public.smart_hoot_config h
    WHERE COALESCE(h.is_active, true) = true
      AND h.ga4_customer_id IS NOT NULL
      AND TRIM(h.ga4_customer_id::text) <> ''
      AND (
        v_all_dealers
        OR TRIM(h.ga4_customer_id::text) = TRIM(p_client_id)
      )
    ORDER BY TRIM(h.ga4_customer_id::text), h.id DESC
  ),
  /* Configured dealers only; one unit per dealer + VIN (fallback sk when VIN missing) */
  scoped AS (
    SELECT DISTINCT ON (
      d.ga4_customer_id,
      COALESCE(NULLIF(TRIM(UPPER(i.vin)), ''), i.sk)
    )
      i.sk,
      i.vin,
      i.make,
      i.model,
      i.year,
      i.condition,
      i.location,
      i.type_,
      d.ga4_customer_id,
      COALESCE(NULLIF(i.price, 0), NULLIF(i.msrp, 0), 0)::numeric AS unit_price
    FROM public.smart_hoot_inventory_daily i
    INNER JOIN dealers d
      ON TRIM(COALESCE(i.customer_name, '')) = d.customer_name
      OR TRIM(COALESCE(i.advertiser, '')) = d.customer_name
    WHERE i.pull_date = v_pull_date
    ORDER BY
      d.ga4_customer_id,
      COALESCE(NULLIF(TRIM(UPPER(i.vin)), ''), i.sk),
      i.snapshotted_at DESC NULLS LAST,
      i.sk
  ),
  filtered AS (
    SELECT
      s.*,
      CASE
        WHEN s.condition ILIKE 'new%'  THEN 'New'
        WHEN s.condition ILIKE 'cert%' THEN 'Certified'
        WHEN s.condition ILIKE 'used%'
          OR s.condition ILIKE 'pre%'   THEN 'Used'
        ELSE COALESCE(NULLIF(TRIM(s.condition), ''), 'Unknown')
      END AS condition_bucket,
      CASE
        WHEN NULLIF(TRIM(s.location), '') IS NULL THEN NULL
        ELSE lower(
          regexp_replace(
            regexp_replace(trim(s.location), '\s*,\s*', ' ', 'g'),
            '\s+', ' ', 'g'
          )
        )
      END AS location_key,
      CASE
        WHEN NULLIF(TRIM(s.make), '') IS NULL THEN NULL
        ELSE lower(
          regexp_replace(
            regexp_replace(
              regexp_replace(trim(s.make), '\s*-\s*', '-', 'g'),
              '\s*,\s*', ' ', 'g'
            ),
            '\s+', ' ', 'g'
          )
        )
      END AS make_key,
      CASE
        WHEN NULLIF(TRIM(s.type_), '') IS NULL THEN NULL
        ELSE lower(
          regexp_replace(
            regexp_replace(trim(s.type_), '\s*,\s*', ' ', 'g'),
            '\s+', ' ', 'g'
          )
        )
      END AS type_key,
      COALESCE(NULLIF(TRIM(s.model), ''), 'Unknown') AS model_label
    FROM scoped s
    WHERE (COALESCE(array_length(p_types, 1), 0) = 0 OR s.type_ = ANY (p_types))
      AND (COALESCE(array_length(p_makes, 1), 0) = 0 OR s.make = ANY (p_makes))
      AND (COALESCE(array_length(p_models, 1), 0) = 0 OR s.model = ANY (p_models))
      AND (
        COALESCE(array_length(p_locations, 1), 0) = 0
        OR lower(
          regexp_replace(
            regexp_replace(trim(s.location), '\s*,\s*', ' ', 'g'),
            '\s+', ' ', 'g'
          )
        ) = ANY (
          SELECT lower(
            regexp_replace(
              regexp_replace(trim(loc), '\s*,\s*', ' ', 'g'),
              '\s+', ' ', 'g'
            )
          )
          FROM unnest(p_locations) AS loc
        )
      )
      AND (
        COALESCE(array_length(p_years, 1), 0) = 0
        OR (s.year ~ '^\d{4}$' AND s.year::int = ANY (p_years))
      )
      AND (
        v_condition = 'BOTH'
        OR (v_condition = 'NEW' AND s.condition ILIKE 'new%')
        OR (
          v_condition = 'USED'
          AND (s.condition ILIKE 'used%' OR s.condition ILIKE 'pre%')
        )
      )
  ),
  totals AS (
    SELECT
      COUNT(*)::bigint AS total_units,
      COALESCE(SUM(unit_price), 0)::numeric AS total_value
    FROM filtered
  ),
  condition_agg AS (
    SELECT
      condition_bucket AS label,
      COUNT(*)::bigint AS units,
      COALESCE(SUM(unit_price), 0)::numeric AS total_value
    FROM filtered
    GROUP BY condition_bucket
  ),
  location_agg AS (
    SELECT
      COALESCE(
        (array_agg(NULLIF(TRIM(f.location), '') ORDER BY
          CASE WHEN TRIM(f.location) ~ ',\s*[A-Za-z]{2}(\s|$)' THEN 0 ELSE 1 END,
          LENGTH(TRIM(f.location)) DESC
        ) FILTER (WHERE NULLIF(TRIM(f.location), '') IS NOT NULL))[1],
        'Unknown'
      ) AS label,
      COUNT(*)::bigint AS units,
      COALESCE(SUM(f.unit_price), 0)::numeric AS total_value
    FROM filtered f
    GROUP BY COALESCE(f.location_key, '_unknown_')
  ),
  make_agg AS (
    SELECT
      COALESCE(
        (array_agg(NULLIF(TRIM(f.make), '') ORDER BY
          LENGTH(TRIM(f.make)) DESC
        ) FILTER (WHERE NULLIF(TRIM(f.make), '') IS NOT NULL))[1],
        'Unknown'
      ) AS label,
      COUNT(*)::bigint AS units,
      COALESCE(SUM(f.unit_price), 0)::numeric AS total_value
    FROM filtered f
    GROUP BY COALESCE(f.make_key, '_unknown_')
  ),
  type_agg AS (
    SELECT
      COALESCE(
        (array_agg(NULLIF(TRIM(f.type_), '') ORDER BY
          LENGTH(TRIM(f.type_)) DESC
        ) FILTER (WHERE NULLIF(TRIM(f.type_), '') IS NOT NULL))[1],
        'Unknown'
      ) AS label,
      COUNT(*)::bigint AS units,
      COALESCE(SUM(f.unit_price), 0)::numeric AS total_value
    FROM filtered f
    GROUP BY COALESCE(f.type_key, '_unknown_')
  ),
  bucket_agg AS (
    SELECT 'condition'::text AS section_key, label, units, total_value FROM condition_agg
    UNION ALL
    SELECT 'location', label, units, total_value FROM location_agg
    UNION ALL
    SELECT 'make', label, units, total_value FROM make_agg
    UNION ALL
    SELECT 'type', label, units, total_value FROM type_agg
  ),
  section_json AS (
    SELECT
      b.section_key,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'label', b.label,
            'units', b.units,
            'totalValue', b.total_value,
            'pct', CASE
              WHEN t.total_units > 0 THEN ROUND(100.0 * b.units / t.total_units, 2)
              ELSE 0
            END
          )
          ORDER BY b.units DESC, b.label
        ),
        '[]'::jsonb
      ) AS rows_json
    FROM bucket_agg b
    CROSS JOIN totals t
    GROUP BY b.section_key
  ),
  list_rows AS (
    SELECT
      COALESCE(
        (array_agg(NULLIF(TRIM(f.make), '') ORDER BY LENGTH(TRIM(f.make)) DESC)
         FILTER (WHERE NULLIF(TRIM(f.make), '') IS NOT NULL))[1],
        'Unknown'
      ) AS manufacturer,
      f.model_label AS brand_model,
      LOWER(f.condition_bucket) AS condition,
      COUNT(*)::bigint AS units,
      COALESCE(SUM(f.unit_price), 0)::numeric AS total_value,
      CASE
        WHEN COUNT(*) > 0 THEN ROUND(COALESCE(SUM(f.unit_price), 0) / COUNT(*), 0)
        ELSE 0
      END AS average_price
    FROM filtered f
    GROUP BY COALESCE(f.make_key, '_unknown_'), f.model_label, LOWER(f.condition_bucket)
  ),
  options_base AS (
    SELECT
      s.year,
      s.make,
      s.model,
      s.type_,
      s.location,
      CASE
        WHEN s.condition ILIKE 'new%'  THEN 'New'
        WHEN s.condition ILIKE 'cert%' THEN 'Certified'
        WHEN s.condition ILIKE 'used%'
          OR s.condition ILIKE 'pre%'   THEN 'Used'
        ELSE COALESCE(NULLIF(TRIM(s.condition), ''), 'Unknown')
      END AS condition_bucket,
      CASE
        WHEN NULLIF(TRIM(s.location), '') IS NULL THEN NULL
        ELSE lower(
          regexp_replace(
            regexp_replace(trim(s.location), '\s*,\s*', ' ', 'g'),
            '\s+', ' ', 'g'
          )
        )
      END AS location_key
    FROM scoped s
  ),
  location_options AS (
    SELECT DISTINCT ON (COALESCE(ob.location_key, '_unknown_'))
      COALESCE(
        NULLIF(TRIM(ob.location), ''),
        'Unknown'
      ) AS location_label
    FROM options_base ob
    ORDER BY
      COALESCE(ob.location_key, '_unknown_'),
      CASE WHEN TRIM(ob.location) ~ ',\s*[A-Za-z]{2}(\s|$)' THEN 0 ELSE 1 END,
      LENGTH(TRIM(ob.location)) DESC
  )
  SELECT jsonb_build_object(
    'ready', true,
    'meta', jsonb_build_object(
      'requestedDate', p_report_date,
      'pullDate', v_pull_date,
      'clientId', NULLIF(TRIM(COALESCE(p_client_id, '')), ''),
      'allDealers', v_all_dealers,
      'source', 'smart_hoot_inventory_daily',
      'rowCount', t.total_units,
      'totalUnits', t.total_units,
      'totalValue', t.total_value,
      'averagePrice', CASE
        WHEN t.total_units > 0 THEN ROUND(t.total_value / t.total_units, 0)
        ELSE 0
      END,
      'filters', jsonb_build_object(
        'types', COALESCE(to_jsonb(p_types), '[]'::jsonb),
        'makes', COALESCE(to_jsonb(p_makes), '[]'::jsonb),
        'models', COALESCE(to_jsonb(p_models), '[]'::jsonb),
        'locations', COALESCE(to_jsonb(p_locations), '[]'::jsonb),
        'years', COALESCE(to_jsonb(p_years), '[]'::jsonb),
        'condition', v_condition
      )
    ),
    'sections', jsonb_build_object(
      'condition', jsonb_build_object(
        'title', 'Condition',
        'labelHeader', 'Conditions',
        'rows', COALESCE((SELECT rows_json FROM section_json WHERE section_key = 'condition'), '[]'::jsonb),
        'totalUnits', t.total_units,
        'totalValue', t.total_value
      ),
      'location', jsonb_build_object(
        'title', 'Location',
        'labelHeader', 'Locations',
        'rows', COALESCE((SELECT rows_json FROM section_json WHERE section_key = 'location'), '[]'::jsonb),
        'totalUnits', t.total_units,
        'totalValue', t.total_value
      ),
      'make', jsonb_build_object(
        'title', 'Make',
        'labelHeader', 'Makes',
        'rows', COALESCE((SELECT rows_json FROM section_json WHERE section_key = 'make'), '[]'::jsonb),
        'totalUnits', t.total_units,
        'totalValue', t.total_value
      ),
      'type', jsonb_build_object(
        'title', 'Type',
        'labelHeader', 'Types',
        'rows', COALESCE((SELECT rows_json FROM section_json WHERE section_key = 'type'), '[]'::jsonb),
        'totalUnits', t.total_units,
        'totalValue', t.total_value
      )
    ),
    'inventoryList', jsonb_build_object(
      'rows', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'manufacturer', r.manufacturer,
            'brandModel', r.brand_model,
            'condition', r.condition,
            'units', r.units,
            'averagePrice', r.average_price,
            'totalValue', r.total_value
          )
          ORDER BY r.manufacturer, r.brand_model, r.condition
        )
        FROM list_rows r
      ), '[]'::jsonb),
      'totalUnits', t.total_units,
      'totalValue', t.total_value,
      'averagePrice', CASE
        WHEN t.total_units > 0 THEN ROUND(t.total_value / t.total_units, 0)
        ELSE 0
      END
    ),
    'filterOptions', jsonb_build_object(
      'years', COALESCE((
        SELECT jsonb_agg(y ORDER BY y DESC)
        FROM (SELECT DISTINCT year AS y FROM options_base WHERE year ~ '^\d{4}$') x
      ), '[]'::jsonb),
      'makes', COALESCE((
        SELECT jsonb_agg(m ORDER BY m)
        FROM (
          SELECT DISTINCT TRIM(make) AS m
          FROM options_base
          WHERE NULLIF(TRIM(make), '') IS NOT NULL
        ) x
      ), '[]'::jsonb),
      'models', COALESCE((
        SELECT jsonb_agg(m ORDER BY m)
        FROM (
          SELECT DISTINCT TRIM(model) AS m
          FROM options_base
          WHERE NULLIF(TRIM(model), '') IS NOT NULL
        ) x
      ), '[]'::jsonb),
      'types', COALESCE((
        SELECT jsonb_agg(ty ORDER BY ty)
        FROM (
          SELECT DISTINCT TRIM(type_) AS ty
          FROM options_base
          WHERE NULLIF(TRIM(type_), '') IS NOT NULL
        ) x
      ), '[]'::jsonb),
      'locations', COALESCE((
        SELECT jsonb_agg(l ORDER BY l)
        FROM (
          SELECT DISTINCT location_label AS l
          FROM location_options
          WHERE location_label IS NOT NULL
        ) x
      ), '[]'::jsonb),
      'conditions', COALESCE((
        SELECT jsonb_agg(c ORDER BY c)
        FROM (SELECT DISTINCT condition_bucket AS c FROM options_base) x
      ), '[]'::jsonb)
    )
  )
  INTO v_result
  FROM totals t;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.get_inventory_report(
  text, date, text[], text[], text[], text[], integer[], text
) IS
  'Full inventory report from smart_hoot_inventory_daily for one pull_date. '
  'p_client_id NULL/empty/__all_dealer__ = All Dealers (active smart_hoot_config dealers only). '
  'Units = one row per sk (deduped). Value uses COALESCE(NULLIF(price,0), NULLIF(msrp,0), 0). '
  'Falls back to latest pull_date ≤ p_report_date when exact day is empty.';

GRANT EXECUTE ON FUNCTION public.get_inventory_report(
  text, date, text[], text[], text[], text[], integer[], text
) TO anon, authenticated, service_role;

-- ── Verification examples (run after deploy) ─────────────────────────────────
--
-- All Dealers, today (or latest ≤ today):
--   SELECT public.get_inventory_report(NULL, CURRENT_DATE);
--
-- One dealer:
--   SELECT public.get_inventory_report('GA4_CLIENT_ID', CURRENT_DATE);
--
-- Filters (Used only, Honda):
--   SELECT public.get_inventory_report(
--     NULL, CURRENT_DATE,
--     NULL, ARRAY['Honda'], NULL, NULL, NULL, 'USED'
--   );
--
-- Match website units/value for a configured dealer on a pull_date:
--   SELECT COUNT(*) AS units,
--          SUM(COALESCE(NULLIF(price,0), NULLIF(msrp,0), 0)) AS total_value
--   FROM public.smart_hoot_inventory_daily d
--   INNER JOIN public.smart_hoot_config h
--     ON TRIM(d.customer_name) = TRIM(h.customer_name)
--    AND TRIM(h.ga4_customer_id::text) = 'GA4_CLIENT_ID'
--   WHERE d.pull_date = CURRENT_DATE;
