-- Scrap Step 3 — independent of Hoot / QS.
-- Fast path: dealer-scoped scrap (+ optional same-dealer hoot) inventory,
-- path equality / VIN / Dealer Spike id= (no full-table LIKE over 77k rows).
-- Includes inv_custom_type (Destination Cycle / smart_final_data column).

CREATE OR REPLACE FUNCTION public.build_smart_final_data_scrap(
  p_client_id text DEFAULT NULL,
  p_days_back integer DEFAULT NULL,
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL
)
RETURNS TABLE (
  client_id text,
  account_name text,
  cms text,
  out_total_rows bigint,
  out_vdp_true_rows bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET lock_timeout = '120s'
SET statement_timeout = '180s'
AS $$
BEGIN
  IF p_client_id IS NULL OR btrim(p_client_id) = '' THEN
    RAISE EXCEPTION 'build_smart_final_data_scrap requires p_client_id (per-dealer only)';
  END IF;

  DELETE FROM public.smart_final_data AS sfd
  WHERE sfd.client_id = trim(p_client_id)
    AND (p_date_from IS NULL OR sfd.report_date >= p_date_from)
    AND (p_date_to IS NULL OR sfd.report_date <= p_date_to)
    AND (
      p_date_from IS NOT NULL
      OR p_days_back IS NULL
      OR sfd.report_date >= CURRENT_DATE - p_days_back
    );

  INSERT INTO public.smart_final_data (
    client_id, ga4_property_id, account_name, report_date,
    page_location, page_path, page_title,
    views, total_users, sessions, new_users, ga4_page_type,
    hoot_customer_name, hoot_id, hoot_url, website_platform,
    inv_sk, inv_vin, inv_url, inv_make, inv_model, inv_year, inv_trim,
    inv_price, inv_msrp, inv_condition, inv_type, inv_custom_type, inv_stock_number,
    inv_location, inv_first_seen, inv_last_seen,
    vdp_conditions, vdp_vehicle_condition, cms
  )
  WITH config_unique AS (
    SELECT DISTINCT ON (
      h.ga4_customer_id,
      COALESCE(NULLIF(btrim(h.ga4_property_id), ''), '__legacy__')
    )
      h.ga4_customer_id,
      h.ga4_property_id,
      h.customer_name,
      h.hoot_id,
      h.hoot_url,
      h.website_platform,
      NULLIF(TRIM(h.inv_type_raw_key), '') AS inv_type_raw_key
    FROM public.smart_hoot_config h
    WHERE h.ga4_customer_id IS NOT NULL
      AND trim(h.ga4_customer_id::text) = trim(p_client_id)
    ORDER BY
      h.ga4_customer_id,
      COALESCE(NULLIF(btrim(h.ga4_property_id), ''), '__legacy__'),
      h.is_active DESC NULLS LAST,
      h.id DESC
  ),
  dealer_names AS (
    SELECT DISTINCT LOWER(TRIM(c.customer_name)) AS customer_name_key
    FROM config_unique c
    WHERE c.customer_name IS NOT NULL AND btrim(c.customer_name) <> ''
    UNION
    SELECT DISTINCT LOWER(TRIM(i.customer_name)) AS customer_name_key
    FROM public.smart_scrap_inventory i
    WHERE NULLIF(TRIM(i.customer_id), '') = trim(p_client_id)
      AND i.customer_name IS NOT NULL
      AND btrim(i.customer_name) <> ''
  ),
  ga4_unique AS (
    SELECT
      g.client_id,
      MAX(g.ga4_property_id)               AS ga4_property_id,
      MAX(g.account_name)                  AS account_name,
      g.report_date,
      g.page_path,
      lower(btrim(g.page_path))            AS path_key,
      public.extract_vin_from_text(g.page_path) AS path_vin,
      public.extract_dealer_spike_listing_id_from_page_path(g.page_path) AS spike_id,
      MAX(g.page_location)                 AS page_location,
      MAX(g.page_title)                    AS page_title,
      MAX(g.ga4_page_type)                 AS ga4_page_type,
      COALESCE(SUM(g.views), 0)::INT       AS views,
      COALESCE(SUM(g.total_users), 0)::INT AS total_users,
      COALESCE(SUM(g.sessions), 0)::INT    AS sessions,
      COALESCE(SUM(g.new_users), 0)::INT   AS new_users
    FROM public.smart_ga4_page_data g
    WHERE g.vdp_conditions = TRUE
      AND g.client_id = trim(p_client_id)
      AND (p_date_from IS NULL OR g.report_date >= p_date_from)
      AND (p_date_to IS NULL OR g.report_date <= p_date_to)
      AND (
        p_date_from IS NOT NULL
        OR p_days_back IS NULL
        OR g.report_date >= CURRENT_DATE - p_days_back
      )
    GROUP BY g.client_id, g.report_date, g.page_path
  ),
  scrap_inv AS (
    SELECT DISTINCT ON (
      COALESCE(NULLIF(TRIM(i.customer_id), ''), LOWER(TRIM(i.customer_name))),
      LOWER(TRIM(i.url))
    )
      i.customer_name::text AS customer_name,
      LOWER(TRIM(i.customer_name)) AS customer_name_key,
      NULLIF(TRIM(i.customer_id), '')::text AS ga4_customer_id,
      LOWER(TRIM(i.url)) AS url_lower,
      lower(split_part(regexp_replace(lower(btrim(i.url)), '^https?://[^/]+', ''), '?', 1)) AS url_path,
      COALESCE(
        NULLIF(upper(btrim(i.vin)), ''),
        public.extract_vin_from_text(i.url)
      ) AS inv_vin,
      i.sk::text AS sk,
      i.vin::text AS vin,
      i.url::text AS url,
      i.make::text AS make,
      i.model::text AS model,
      NULLIF(TRIM(i.year), '') AS year,
      i.trim::text AS trim,
      i.price::numeric AS price,
      i.msrp::numeric AS msrp,
      i.condition::text AS condition,
      i.type_::text AS type_,
      i.stock_number::text AS stock_number,
      i.location::text AS location,
      i.first_seen,
      i.last_seen,
      NULL::jsonb AS raw_data,
      1 AS match_priority
    FROM public.smart_scrap_inventory i
    WHERE i.url IS NOT NULL
      AND i.url <> ''
      AND (
        NULLIF(TRIM(i.customer_id), '') = trim(p_client_id)
        OR EXISTS (
          SELECT 1 FROM dealer_names dn
          WHERE dn.customer_name_key = LOWER(TRIM(i.customer_name))
        )
      )
    ORDER BY COALESCE(NULLIF(TRIM(i.customer_id), ''), LOWER(TRIM(i.customer_name))),
             LOWER(TRIM(i.url)),
             i.last_seen DESC NULLS LAST,
             i.first_seen DESC NULLS LAST
  ),
  hoot_inv AS (
    SELECT DISTINCT ON (LOWER(TRIM(i.customer_name)), LOWER(TRIM(i.url)))
      i.customer_name::text AS customer_name,
      LOWER(TRIM(i.customer_name)) AS customer_name_key,
      NULL::text AS ga4_customer_id,
      LOWER(TRIM(i.url)) AS url_lower,
      lower(split_part(regexp_replace(lower(btrim(i.url)), '^https?://[^/]+', ''), '?', 1)) AS url_path,
      COALESCE(
        NULLIF(upper(btrim(i.vin::text)), ''),
        public.extract_vin_from_text(i.url::text)
      ) AS inv_vin,
      i.sk::text AS sk,
      i.vin::text AS vin,
      i.url::text AS url,
      i.make::text AS make,
      i.model::text AS model,
      NULLIF(TRIM(i.year::text), '') AS year,
      i.trim::text AS trim,
      i.price::numeric AS price,
      i.msrp::numeric AS msrp,
      i.condition::text AS condition,
      i.type_::text AS type_,
      i.stock_number::text AS stock_number,
      i.location::text AS location,
      i.first_seen,
      i.last_seen,
      i.raw_data,
      2 AS match_priority
    FROM public.smart_hoot_inventory i
    WHERE i.url IS NOT NULL
      AND i.url <> ''
      AND EXISTS (
        SELECT 1 FROM dealer_names dn
        WHERE dn.customer_name_key = LOWER(TRIM(i.customer_name))
      )
    ORDER BY LOWER(TRIM(i.customer_name)), LOWER(TRIM(i.url)),
             i.last_seen DESC NULLS LAST,
             i.first_seen DESC NULLS LAST
  ),
  inv_norm AS (
    SELECT * FROM scrap_inv
    UNION ALL
    SELECT * FROM hoot_inv
  ),
  matched AS (
    SELECT
      u.client_id,
      u.ga4_property_id,
      u.account_name,
      u.report_date,
      u.page_location,
      u.page_path,
      u.page_title,
      u.ga4_page_type,
      u.views,
      u.total_users,
      u.sessions,
      u.new_users,
      c.customer_name,
      c.hoot_id,
      c.hoot_url,
      c.website_platform,
      c.inv_type_raw_key,
      iu.sk, iu.vin, iu.url, iu.make, iu.model, iu.year, iu.trim,
      iu.price, iu.msrp, iu.condition, iu.type_, iu.stock_number,
      iu.location, iu.first_seen, iu.last_seen, iu.raw_data
    FROM ga4_unique u
    LEFT JOIN config_unique c
           ON trim(c.ga4_customer_id::text) = trim(u.client_id)
          AND public.ga4_property_scope_matches(u.ga4_property_id, c.ga4_property_id)
    LEFT JOIN LATERAL (
      SELECT x.*
      FROM inv_norm x
      WHERE (
          x.ga4_customer_id = trim(u.client_id)
          OR (
            c.customer_name IS NOT NULL
            AND x.customer_name_key = LOWER(TRIM(c.customer_name))
          )
        )
        AND u.path_key IS NOT NULL AND u.path_key <> ''
        AND x.url_path = u.path_key
      ORDER BY x.match_priority ASC, LENGTH(x.url_lower) DESC NULLS LAST
      LIMIT 1
    ) by_path ON TRUE
    LEFT JOIN LATERAL (
      SELECT x.*
      FROM inv_norm x
      WHERE by_path.sk IS NULL
        AND (
          x.ga4_customer_id = trim(u.client_id)
          OR (
            c.customer_name IS NOT NULL
            AND x.customer_name_key = LOWER(TRIM(c.customer_name))
          )
        )
        AND u.path_vin IS NOT NULL
        AND x.inv_vin IS NOT NULL
        AND x.inv_vin = u.path_vin
      ORDER BY x.match_priority ASC
      LIMIT 1
    ) by_vin ON TRUE
    LEFT JOIN LATERAL (
      SELECT x.*
      FROM inv_norm x
      WHERE by_path.sk IS NULL
        AND by_vin.sk IS NULL
        AND u.spike_id IS NOT NULL
        AND (
          x.ga4_customer_id = trim(u.client_id)
          OR (
            c.customer_name IS NOT NULL
            AND x.customer_name_key = LOWER(TRIM(c.customer_name))
          )
        )
        AND x.url_lower LIKE '%id=' || u.spike_id || '%'
      ORDER BY x.match_priority ASC
      LIMIT 1
    ) by_spike ON TRUE
    CROSS JOIN LATERAL (
      SELECT
        COALESCE(by_path.sk, by_vin.sk, by_spike.sk) AS sk,
        COALESCE(by_path.vin, by_vin.vin, by_spike.vin) AS vin,
        COALESCE(by_path.url, by_vin.url, by_spike.url) AS url,
        COALESCE(by_path.make, by_vin.make, by_spike.make) AS make,
        COALESCE(by_path.model, by_vin.model, by_spike.model) AS model,
        COALESCE(by_path.year, by_vin.year, by_spike.year) AS year,
        COALESCE(by_path.trim, by_vin.trim, by_spike.trim) AS trim,
        COALESCE(by_path.price, by_vin.price, by_spike.price) AS price,
        COALESCE(by_path.msrp, by_vin.msrp, by_spike.msrp) AS msrp,
        COALESCE(by_path.condition, by_vin.condition, by_spike.condition) AS condition,
        COALESCE(by_path.type_, by_vin.type_, by_spike.type_) AS type_,
        COALESCE(by_path.stock_number, by_vin.stock_number, by_spike.stock_number) AS stock_number,
        COALESCE(by_path.location, by_vin.location, by_spike.location) AS location,
        COALESCE(by_path.first_seen, by_vin.first_seen, by_spike.first_seen) AS first_seen,
        COALESCE(by_path.last_seen, by_vin.last_seen, by_spike.last_seen) AS last_seen,
        COALESCE(by_path.raw_data, by_vin.raw_data, by_spike.raw_data) AS raw_data
    ) iu
  )
  SELECT
    m.client_id,
    m.ga4_property_id,
    m.account_name,
    m.report_date,
    m.page_location,
    m.page_path,
    m.page_title,
    m.views,
    m.total_users,
    m.sessions,
    m.new_users,
    m.ga4_page_type,
    m.customer_name,
    m.hoot_id,
    m.hoot_url,
    m.website_platform,
    m.sk,
    m.vin,
    m.url,
    m.make,
    m.model,
    m.year,
    m.trim,
    m.price,
    m.msrp,
    m.condition,
    m.type_,
    COALESCE(
      NULLIF(TRIM(m.type_), ''),
      CASE
        WHEN m.inv_type_raw_key IS NULL THEN NULL
        ELSE NULLIF(TRIM(m.raw_data ->> m.inv_type_raw_key), '')
      END
    ) AS inv_custom_type,
    m.stock_number,
    m.location,
    m.first_seen,
    m.last_seen,
    CASE
      WHEN m.page_path IS NOT NULL
       AND m.page_path <> ''
       AND m.url IS NOT NULL
       AND m.url <> ''
      THEN TRUE
      ELSE FALSE
    END AS vdp_conditions,
    CASE
      WHEN m.condition ILIKE 'new%'  THEN 'New'
      WHEN m.condition ILIKE 'used%' THEN 'Used'
      WHEN m.condition ILIKE 'pre%'  THEN 'Used'
      ELSE NULL
    END AS vdp_vehicle_condition,
    m.website_platform AS cms
  FROM matched m;

  RETURN QUERY
  SELECT
    s.client_id::text,
    s.account_name::text,
    s.cms::text,
    COUNT(*)::BIGINT AS out_total_rows,
    COUNT(*) FILTER (WHERE s.vdp_conditions = TRUE)::BIGINT AS out_vdp_true_rows
  FROM public.smart_final_data s
  WHERE s.client_id = trim(p_client_id)
    AND (p_date_from IS NULL OR s.report_date >= p_date_from)
    AND (p_date_to IS NULL OR s.report_date <= p_date_to)
    AND (
      p_date_from IS NOT NULL
      OR p_days_back IS NULL
      OR s.report_date >= CURRENT_DATE - p_days_back
    )
  GROUP BY s.client_id, s.account_name, s.cms
  ORDER BY s.account_name;
END;
$$;

COMMENT ON FUNCTION public.build_smart_final_data_scrap(text, integer, date, date) IS
  'Scrap Step 3 only — dealer-scoped fast match (path/VIN/Dealer Spike). Independent of Hoot/QS.';

GRANT EXECUTE ON FUNCTION public.build_smart_final_data_scrap(text, integer, date, date)
  TO service_role;
