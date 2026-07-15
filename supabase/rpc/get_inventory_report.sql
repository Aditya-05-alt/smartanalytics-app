-- Full Inventory Report from daily inventory snapshots.
-- Pipeline: smart-hoot-inv-live → smart_hoot_inventory_live
--           inventory-report-daily-sync → smart_hoot_inventory_daily
--           get_inventory_report → frontend
-- Sources: smart_hoot_inventory_daily (hoot) + smart_scrap_inventory_daily (scrap).
-- Per dealer: hoot when configured; scrap when scrap_link on or hoot has no rows for that date.
-- One pull_date snapshot + filters. Supports single dealer OR All Dealers.
-- Units = one row per sk on that pull_date (Hoot API grain).
-- Hoot: all units on pull_date (sourced from smart_hoot_inventory_live daily snapshot; no last_seen filter).
-- Scrap: pull_date match only.
-- Value = SUM(COALESCE(NULLIF(price,0), NULLIF(msrp,0), 0)).
-- Deploy in Supabase SQL Editor (full file).

DROP FUNCTION IF EXISTS public.get_inventory_report(
  text, date, text[], text[], text[], text[], integer[], text
);

CREATE OR REPLACE FUNCTION public.get_inventory_report(
  p_client_id    text DEFAULT NULL,          -- ga4_customer_id; NULL / '' / '__all_dealer__' = All Dealers
  p_report_date  date DEFAULT CURRENT_DATE,  -- exact pull_date (hoot and/or scrap daily)
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
  v_all_dealers       boolean;
  v_pull_date         date;
  v_condition         text := UPPER(TRIM(COALESCE(p_condition, 'BOTH')));
  v_business_today    date := (timezone('Asia/Kolkata', now()))::date;
  v_result            jsonb;
BEGIN
  IF p_report_date IS NULL THEN
    RAISE EXCEPTION 'p_report_date is required';
  END IF;

  v_pull_date := p_report_date;

  v_all_dealers := (
    p_client_id IS NULL
    OR TRIM(p_client_id) = ''
    OR TRIM(p_client_id) = '__all_dealer__'
  );

  -- Early exit when no configured dealer has hoot OR scrap rows on the requested date.
  IF NOT EXISTS (
    SELECT 1
    FROM public.smart_hoot_config h
    WHERE COALESCE(h.is_active, true) = true
      AND h.ga4_customer_id IS NOT NULL
      AND TRIM(h.ga4_customer_id::text) <> ''
      AND (
        v_all_dealers
        OR TRIM(h.ga4_customer_id::text) = TRIM(p_client_id)
      )
      AND (
        EXISTS (
          SELECT 1
          FROM public.smart_hoot_inventory_daily d
          WHERE d.pull_date = p_report_date
            AND (
              TRIM(COALESCE(d.customer_name, '')) = TRIM(h.customer_name)
              OR TRIM(COALESCE(d.advertiser, '')) = TRIM(h.customer_name)
              OR TRIM(COALESCE(d.customer_name, '')) ILIKE TRIM(h.customer_name) || '%'
              OR TRIM(h.customer_name) ILIKE TRIM(COALESCE(d.customer_name, '')) || '%'
            )
        )
        OR EXISTS (
          SELECT 1
          FROM public.smart_scrap_inventory_daily d
          WHERE d.pull_date = p_report_date
            AND (
              TRIM(COALESCE(d.customer_id, '')) = TRIM(h.ga4_customer_id::text)
              OR TRIM(COALESCE(d.customer_name, '')) = TRIM(h.customer_name)
              OR TRIM(COALESCE(d.advertiser, '')) = TRIM(h.customer_name)
            )
        )
      )
  ) THEN
    RETURN jsonb_build_object(
      'ready', true,
      'meta', jsonb_build_object(
        'requestedDate', p_report_date,
        'pullDate', NULL,
        'clientId', NULLIF(TRIM(COALESCE(p_client_id, '')), ''),
        'allDealers', v_all_dealers,
        'source', 'inventory_daily',
        'inventorySource', 'none',
        'rowCount', 0,
        'message', 'No inventory snapshot for the requested date'
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

  WITH dealers AS (
    SELECT DISTINCT ON (TRIM(h.ga4_customer_id::text))
      TRIM(h.ga4_customer_id::text) AS ga4_customer_id,
      TRIM(h.customer_name)         AS customer_name,
      NULLIF(TRIM(h.hoot_url), '')  AS hoot_url
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
  dealer_mode AS (
    SELECT
      d.ga4_customer_id,
      d.customer_name,
      CASE
        WHEN NULLIF(TRIM(v.hoot_link), '') IS NOT NULL THEN 'hoot'
        WHEN lower(TRIM(COALESCE(v.scrap_link, ''))) = 'on' THEN 'scrap'
        WHEN TRIM(COALESCE(v.scrap_link, '')) ~* '^https?://' THEN 'scrap'
        -- Hoot URL / hoot daily before scrap-exists so leftover scrap rows don't blank hoot dealers
        WHEN NULLIF(TRIM(d.hoot_url), '') IS NOT NULL THEN 'hoot'
        WHEN EXISTS (
          SELECT 1
          FROM public.smart_hoot_inventory_daily hd
          WHERE hd.pull_date = p_report_date
            AND (
              TRIM(COALESCE(hd.customer_name, '')) = d.customer_name
              OR TRIM(COALESCE(hd.advertiser, '')) = d.customer_name
            )
        ) THEN 'hoot'
        WHEN EXISTS (
          SELECT 1
          FROM public.smart_scrap_inventory_daily sd
          WHERE sd.pull_date = p_report_date
            AND (
              TRIM(COALESCE(sd.customer_id, '')) = d.ga4_customer_id
              OR TRIM(COALESCE(sd.customer_name, '')) = d.customer_name
              OR TRIM(COALESCE(sd.advertiser, '')) = d.customer_name
              OR TRIM(COALESCE(sd.customer_name, '')) ILIKE TRIM(d.customer_name) || '%'
              OR TRIM(d.customer_name) ILIKE TRIM(COALESCE(sd.customer_name, '')) || '%'
            )
        ) THEN 'scrap'
        ELSE 'scrap'
      END AS preferred_source
    FROM dealers d
    LEFT JOIN LATERAL (
      SELECT vl.hoot_link, vl.scrap_link
      FROM public.smart_vdp_logic vl
      WHERE TRIM(COALESCE(vl.dealer_id, '')) = d.ga4_customer_id
         OR (
           NULLIF(TRIM(vl.dealer_name), '') IS NOT NULL
           AND TRIM(vl.dealer_name) = d.customer_name
         )
      ORDER BY vl.id DESC
      LIMIT 1
    ) v ON true
  ),
  hoot_dealers_with_data AS (
    SELECT DISTINCT dm.ga4_customer_id
    FROM dealer_mode dm
    INNER JOIN public.smart_hoot_inventory_daily i
      ON i.pull_date = p_report_date
     AND (
       TRIM(COALESCE(i.customer_name, '')) = dm.customer_name
       OR TRIM(COALESCE(i.advertiser, '')) = dm.customer_name
       OR TRIM(COALESCE(i.customer_name, '')) ILIKE dm.customer_name || '%'
       OR dm.customer_name ILIKE TRIM(COALESCE(i.customer_name, '')) || '%'
     )
  ),
  scrap_dealers_with_data AS (
    SELECT DISTINCT dm.ga4_customer_id
    FROM dealer_mode dm
    INNER JOIN public.smart_scrap_inventory_daily i
      ON i.pull_date = p_report_date
     AND (
       TRIM(COALESCE(i.customer_id, '')) = dm.ga4_customer_id
       OR TRIM(COALESCE(i.customer_name, '')) = dm.customer_name
       OR TRIM(COALESCE(i.advertiser, '')) = dm.customer_name
       OR TRIM(COALESCE(i.customer_name, '')) ILIKE TRIM(dm.customer_name) || '%'
       OR TRIM(dm.customer_name) ILIKE TRIM(COALESCE(i.customer_name, '')) || '%'
     )
  ),
  inventory_raw AS (
    SELECT
      i.sk,
      i.vin,
      i.make,
      i.model,
      i.year,
      i.condition,
      i.location,
      i.type_,
      dm.ga4_customer_id,
      COALESCE(NULLIF(i.price, 0), NULLIF(i.msrp, 0), 0)::numeric AS unit_price,
      i.snapshotted_at,
      'hoot'::text AS data_source
    FROM dealer_mode dm
    INNER JOIN public.smart_hoot_inventory_daily i
      ON i.pull_date = p_report_date
     AND (
       TRIM(COALESCE(i.customer_name, '')) = dm.customer_name
       OR TRIM(COALESCE(i.advertiser, '')) = dm.customer_name
       OR TRIM(COALESCE(i.customer_name, '')) ILIKE dm.customer_name || '%'
       OR dm.customer_name ILIKE TRIM(COALESCE(i.customer_name, '')) || '%'
     )
    WHERE dm.preferred_source = 'hoot'

    UNION ALL

    SELECT
      i.sk,
      i.vin,
      i.make,
      i.model,
      i.year,
      i.condition,
      i.location,
      i.type_,
      dm.ga4_customer_id,
      COALESCE(NULLIF(i.price, 0), NULLIF(i.msrp, 0), 0)::numeric AS unit_price,
      i.snapshotted_at,
      'scrap'::text AS data_source
    FROM dealer_mode dm
    INNER JOIN public.smart_scrap_inventory_daily i
      ON i.pull_date = p_report_date
     AND (
       TRIM(COALESCE(i.customer_id, '')) = dm.ga4_customer_id
       OR TRIM(COALESCE(i.customer_name, '')) = dm.customer_name
       OR TRIM(COALESCE(i.advertiser, '')) = dm.customer_name
       OR TRIM(COALESCE(i.customer_name, '')) ILIKE TRIM(dm.customer_name) || '%'
       OR TRIM(dm.customer_name) ILIKE TRIM(COALESCE(i.customer_name, '')) || '%'
     )
    WHERE dm.preferred_source = 'scrap'
       OR (
         dm.preferred_source = 'hoot'
         AND NOT EXISTS (
           SELECT 1
           FROM hoot_dealers_with_data hd
           WHERE hd.ga4_customer_id = dm.ga4_customer_id
         )
         AND EXISTS (
           SELECT 1
           FROM scrap_dealers_with_data sd
           WHERE sd.ga4_customer_id = dm.ga4_customer_id
         )
       )
  ),
  /* One unit per dealer + sk (Hoot API grain; do not collapse duplicate VINs) */
  scoped AS (
    SELECT DISTINCT ON (r.ga4_customer_id, r.sk)
      r.sk,
      r.vin,
      r.make,
      r.model,
      r.year,
      r.condition,
      r.location,
      r.type_,
      r.ga4_customer_id,
      r.unit_price,
      r.data_source
    FROM inventory_raw r
    ORDER BY
      r.ga4_customer_id,
      r.sk,
      r.snapshotted_at DESC NULLS LAST
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
      COALESCE(SUM(unit_price), 0)::numeric AS total_value,
      COUNT(*) FILTER (WHERE data_source = 'hoot')::bigint AS hoot_units,
      COUNT(*) FILTER (WHERE data_source = 'scrap')::bigint AS scrap_units
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
      CASE
        WHEN NULLIF(TRIM(f.type_), '') IS NULL THEN '(No type)'
        ELSE TRIM(f.type_)
      END AS label,
      COUNT(*)::bigint AS units,
      COALESCE(SUM(f.unit_price), 0)::numeric AS total_value
    FROM filtered f
    GROUP BY 1
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
      'source', CASE
        WHEN t.hoot_units > 0 AND t.scrap_units > 0 THEN 'hoot+scrap'
        WHEN t.scrap_units > 0 THEN 'smart_scrap_inventory_daily'
        ELSE 'smart_hoot_inventory_daily'
      END,
      'inventorySource', CASE
        WHEN t.hoot_units > 0 AND t.scrap_units > 0 THEN 'mixed'
        WHEN t.scrap_units > 0 THEN 'scrap'
        ELSE 'hoot'
      END,
      'hootUnits', t.hoot_units,
      'scrapUnits', t.scrap_units,
      'rowCount', t.total_units,
      'totalUnits', t.total_units,
      'totalValue', t.total_value,
      'averagePrice', CASE
        WHEN t.total_units > 0 THEN ROUND(t.total_value / t.total_units, 0)
        ELSE 0
      END,
      'countMode', 'snapshot_sk_pull_date',
      'hootSource', 'smart_hoot_inventory_live',
      'businessToday', v_business_today,
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
  'Full inventory report from daily snapshots (hoot + scrap). '
  'Per dealer: uses smart_hoot_inventory_daily when hoot is configured and has rows; '
  'otherwise smart_scrap_inventory_daily for scrap dealers or hoot fallback. '
  'Scrap daily rows use pull_date match only. '
  'Hoot: all units on pull_date from smart_hoot_inventory_live daily snapshot (no last_seen filter). '
  'p_client_id NULL/empty/__all_dealer__ = All Dealers. '
  'Exact pull_date only (p_report_date). '
  'Units = one row per dealer+sk. Value uses COALESCE(NULLIF(price,0), NULLIF(msrp,0), 0).';

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
-- Snapshot both sources for today:
--   SELECT * FROM public.snapshot_all_inventory_daily(CURRENT_DATE);
--
-- Scrap-only dealer report:
--   SELECT public.get_inventory_report('GA4_SCRAP_CLIENT_ID', CURRENT_DATE);
