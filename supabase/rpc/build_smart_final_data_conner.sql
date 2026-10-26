-- Conner Step 3: same matching as build_smart_final_data (Hoot), but the inventory
-- source is smart_conner_config + smart_conner_inventory (Scout RV / ScoutX VLA feeds).
--
-- smart_conner_inventory keeps one row per unit per pull day, so each unit (dealer + url)
-- uses its latest snapshot; first/last seen span every snapshot of that unit.
--
-- Safety:
--   * p_client_id is required (never a whole-table rebuild).
--   * Refuses to run when the dealer has no Conner feed or no Conner inventory, so a
--     dealer's existing Final rows are never replaced by unmatched rows.
--   * p_dry_run defaults to TRUE: returns counts only, smart_final_data is untouched.
--   * Report dates before (first Conner snapshot - 1 day) are never rebuilt, so Final rows
--     built from Hoot/Scrap before the switch to Conner are kept.

DROP FUNCTION IF EXISTS public.build_smart_final_data_conner(text, integer, date, date, boolean);

CREATE OR REPLACE FUNCTION public.build_smart_final_data_conner(
  p_client_id text,
  p_days_back integer DEFAULT NULL,
  p_date_from date DEFAULT NULL,
  p_date_to   date DEFAULT NULL,
  p_dry_run   boolean DEFAULT true
)
RETURNS TABLE(
  client_id         text,
  account_name      text,
  cms               text,
  out_total_rows    bigint,
  out_matched_rows  bigint,
  out_dry_run       boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET lock_timeout TO '120s'
SET statement_timeout TO '180s'
AS $function$
#variable_conflict use_column
DECLARE
  v_client text := btrim(p_client_id);
  v_from   date;
  v_to     date;
  v_first  date;
BEGIN
  IF v_client IS NULL OR v_client = '' THEN
    RAISE EXCEPTION 'build_smart_final_data_conner: p_client_id is required';
  END IF;
  IF p_date_from IS NULL AND p_days_back IS NULL THEN
    RAISE EXCEPTION 'build_smart_final_data_conner: pass p_days_back or p_date_from/p_date_to';
  END IF;

  v_from := COALESCE(p_date_from, CURRENT_DATE - p_days_back);
  v_to   := COALESCE(p_date_to, CURRENT_DATE);

  IF NOT EXISTS (
    SELECT 1 FROM public.smart_conner_config c
    WHERE btrim(c.ga4_customer_id::text) = v_client
      AND NULLIF(btrim(c.hoot_url), '') IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'build_smart_final_data_conner: no Conner feed configured for %', v_client;
  END IF;

  SELECT MIN(i.update_date)
    INTO v_first
  FROM public.smart_conner_inventory i
  JOIN public.smart_conner_config c
    ON LOWER(TRIM(c.customer_name)) = LOWER(TRIM(i.customer_name))
  WHERE btrim(c.ga4_customer_id::text) = v_client
    AND NULLIF(btrim(c.hoot_url), '') IS NOT NULL;

  IF v_first IS NULL THEN
    RAISE EXCEPTION 'build_smart_final_data_conner: no Conner inventory loaded for %', v_client;
  END IF;

  -- GA4 for day D lands on D+1, so the first snapshot also covers the day before it.
  v_from := GREATEST(v_from, v_first - 1);

  DROP TABLE IF EXISTS pg_temp._conner_final;

  CREATE TEMP TABLE _conner_final ON COMMIT DROP AS
  WITH config_unique AS (
    SELECT DISTINCT ON (
      btrim(h.ga4_customer_id::text),
      COALESCE(NULLIF(btrim(h.ga4_property_id), ''), '__legacy__')
    )
      h.ga4_customer_id,
      h.ga4_property_id,
      h.customer_name,
      h.hoot_id,
      h.hoot_url,
      h.website_platform,
      NULLIF(TRIM(h.inv_type_raw_key), '') AS inv_type_raw_key
    FROM public.smart_conner_config h
    WHERE btrim(h.ga4_customer_id::text) = v_client
      AND NULLIF(btrim(h.hoot_url), '') IS NOT NULL
    ORDER BY
      btrim(h.ga4_customer_id::text),
      COALESCE(NULLIF(btrim(h.ga4_property_id), ''), '__legacy__'),
      h.is_active DESC NULLS LAST,
      h.id DESC
  ),
  dealer_names AS (
    SELECT DISTINCT LOWER(TRIM(c.customer_name)) AS customer_name_key
    FROM config_unique c
    WHERE NULLIF(btrim(c.customer_name), '') IS NOT NULL
  ),
  ga4_unique AS (
    SELECT
      g.client_id,
      MAX(g.ga4_property_id) AS ga4_property_id,
      MAX(g.account_name) AS account_name,
      g.report_date,
      g.page_path,
      lower(btrim(g.page_path)) AS path_key,
      public.extract_vin_from_text(g.page_path) AS path_vin,
      public.extract_dx1_listing_id_from_page_path(g.page_path) AS dx1_id,
      lower((regexp_match(btrim(g.page_path), '[-/]([A-Za-z0-9]{3,})/?$'))[1]) AS path_tail,
      (regexp_match(btrim(g.page_path), '/([0-9]{5,})/?$'))[1] AS path_lid,
      lower((regexp_match(btrim(g.page_path), '([0-9a-fA-F]{32})\.htm'))[1]) AS path_hash,
      MAX(g.page_location) AS page_location,
      MAX(g.page_title) AS page_title,
      MAX(g.ga4_page_type) AS ga4_page_type,
      COALESCE(SUM(g.views), 0)::INT AS views,
      COALESCE(SUM(g.total_users), 0)::INT AS total_users,
      COALESCE(SUM(g.sessions), 0)::INT AS sessions,
      COALESCE(SUM(g.new_users), 0)::INT AS new_users
    FROM public.smart_ga4_page_data g
    WHERE g.vdp_conditions = TRUE
      AND g.client_id = v_client
      AND g.report_date BETWEEN v_from AND v_to
    GROUP BY g.client_id, g.report_date, g.page_path
  ),
  inv_hist AS (
    SELECT
      i.*,
      LOWER(TRIM(i.customer_name)) AS customer_name_key,
      LOWER(TRIM(i.url)) AS url_lower,
      MIN(i.first_seen) OVER w AS hist_first_seen,
      MAX(COALESCE(i.last_seen, i.first_seen)) OVER w AS hist_last_seen,
      row_number() OVER (
        PARTITION BY LOWER(TRIM(i.customer_name)), LOWER(TRIM(i.url))
        ORDER BY i.update_date DESC, i.id DESC
      ) AS rn
    FROM public.smart_conner_inventory i
    WHERE NULLIF(btrim(i.url), '') IS NOT NULL
      AND LOWER(TRIM(i.customer_name)) IN (SELECT dn.customer_name_key FROM dealer_names dn)
    WINDOW w AS (PARTITION BY LOWER(TRIM(i.customer_name)), LOWER(TRIM(i.url)))
  ),
  inv_norm AS (
    SELECT
      x.customer_name,
      x.customer_name_key,
      x.url_lower,
      lower(split_part(regexp_replace(lower(btrim(x.url)), '^https?://[^/]+', ''), '?', 1)) AS url_path,
      public.extract_dx1_listing_id_from_page_path(x.url) AS dx1_id,
      (regexp_match(
        split_part(regexp_replace(lower(btrim(x.url)), '^https?://[^/]+', ''), '?', 1),
        '/([0-9]{5,})/?$'
      ))[1] AS url_lid,
      lower((regexp_match(x.url, '([0-9a-fA-F]{32})\.htm'))[1]) AS url_hash,
      COALESCE(
        NULLIF(upper(btrim(x.vin)), ''),
        public.extract_vin_from_text(x.url)
      ) AS inv_vin,
      lower(NULLIF(btrim(x.stock_number), '')) AS stock_key,
      lower(NULLIF(btrim(x.vin), '')) AS vin_key,
      x.sk, x.vin, x.url, x.make, x.model, x.year, x.trim,
      x.price, x.msrp, x.condition, x.type_, x.stock_number,
      x.location,
      x.hist_first_seen AS first_seen,
      x.hist_last_seen AS last_seen,
      x.raw_data
    FROM inv_hist x
    WHERE x.rn = 1
  ),
  matched AS (
    SELECT DISTINCT ON (u.client_id, u.report_date, u.page_path)
      u.client_id, u.ga4_property_id, u.account_name, u.report_date,
      u.page_location, u.page_path, u.page_title, u.ga4_page_type,
      u.views, u.total_users, u.sessions, u.new_users,
      c.customer_name, c.hoot_id, c.hoot_url, c.website_platform, c.inv_type_raw_key,
      iu.sk, iu.vin, iu.url, iu.make, iu.model, iu.year, iu.trim,
      iu.price, iu.msrp, iu.condition, iu.type_, iu.stock_number,
      iu.location, iu.first_seen, iu.last_seen, iu.raw_data
    FROM ga4_unique u
    LEFT JOIN config_unique c
           ON btrim(c.ga4_customer_id::text) = btrim(u.client_id)
          AND public.ga4_property_scope_matches(u.ga4_property_id, c.ga4_property_id)
    LEFT JOIN LATERAL (
      SELECT x.*
      FROM inv_norm x
      WHERE c.customer_name IS NOT NULL
        AND x.customer_name_key = LOWER(TRIM(c.customer_name))
        AND u.path_key IS NOT NULL AND u.path_key <> ''
        AND (
          x.url_path = u.path_key
          OR x.url_path = regexp_replace(u.path_key, 'g$', '')
          OR regexp_replace(x.url_path, 'g$', '') = regexp_replace(u.path_key, 'g$', '')
        )
      LIMIT 1
    ) by_path ON TRUE
    LEFT JOIN LATERAL (
      SELECT x.*
      FROM inv_norm x
      WHERE by_path.sk IS NULL
        AND c.customer_name IS NOT NULL
        AND x.customer_name_key = LOWER(TRIM(c.customer_name))
        AND u.path_vin IS NOT NULL
        AND x.inv_vin IS NOT NULL
        AND x.inv_vin = u.path_vin
      LIMIT 1
    ) by_vin ON TRUE
    LEFT JOIN LATERAL (
      SELECT x.*
      FROM inv_norm x
      WHERE by_path.sk IS NULL
        AND by_vin.sk IS NULL
        AND c.customer_name IS NOT NULL
        AND x.customer_name_key = LOWER(TRIM(c.customer_name))
        AND u.dx1_id IS NOT NULL
        AND x.dx1_id IS NOT NULL
        AND x.dx1_id = u.dx1_id
      LIMIT 1
    ) by_dx1 ON TRUE
    LEFT JOIN LATERAL (
      SELECT x.*
      FROM inv_norm x
      WHERE by_path.sk IS NULL
        AND by_vin.sk IS NULL
        AND by_dx1.sk IS NULL
        AND c.customer_name IS NOT NULL
        AND x.customer_name_key = LOWER(TRIM(c.customer_name))
        AND (
          (u.path_lid IS NOT NULL AND x.url_lid = u.path_lid)
          OR (u.path_hash IS NOT NULL AND x.url_hash = u.path_hash)
        )
      LIMIT 1
    ) by_lid ON TRUE
    -- Scout RV URLs end in the feed id ("...-jay-feather-9679"), which is loaded as stock_number.
    LEFT JOIN LATERAL (
      SELECT x.*
      FROM inv_norm x
      WHERE by_path.sk IS NULL
        AND by_vin.sk IS NULL
        AND by_dx1.sk IS NULL
        AND by_lid.sk IS NULL
        AND c.customer_name IS NOT NULL
        AND x.customer_name_key = LOWER(TRIM(c.customer_name))
        AND u.path_tail IS NOT NULL
        AND (u.path_tail ~ '[a-z]' OR length(u.path_tail) >= 6 OR x.stock_key = u.path_tail)
        AND (x.stock_key = u.path_tail OR x.vin_key = u.path_tail)
        -- Short stock codes can collide; the unit's year must appear in the path too.
        AND (NULLIF(btrim(x.year), '') IS NULL OR strpos(u.page_path, btrim(x.year)) > 0)
      LIMIT 1
    ) by_stock ON TRUE
    CROSS JOIN LATERAL (
      SELECT
        COALESCE(by_path.sk, by_vin.sk, by_dx1.sk, by_lid.sk, by_stock.sk) AS sk,
        COALESCE(by_path.vin, by_vin.vin, by_dx1.vin, by_lid.vin, by_stock.vin) AS vin,
        COALESCE(by_path.url, by_vin.url, by_dx1.url, by_lid.url, by_stock.url) AS url,
        COALESCE(by_path.make, by_vin.make, by_dx1.make, by_lid.make, by_stock.make) AS make,
        COALESCE(by_path.model, by_vin.model, by_dx1.model, by_lid.model, by_stock.model) AS model,
        COALESCE(by_path.year, by_vin.year, by_dx1.year, by_lid.year, by_stock.year) AS year,
        COALESCE(by_path.trim, by_vin.trim, by_dx1.trim, by_lid.trim, by_stock.trim) AS trim,
        COALESCE(by_path.price, by_vin.price, by_dx1.price, by_lid.price, by_stock.price) AS price,
        COALESCE(by_path.msrp, by_vin.msrp, by_dx1.msrp, by_lid.msrp, by_stock.msrp) AS msrp,
        COALESCE(by_path.condition, by_vin.condition, by_dx1.condition, by_lid.condition, by_stock.condition) AS condition,
        COALESCE(by_path.type_, by_vin.type_, by_dx1.type_, by_lid.type_, by_stock.type_) AS type_,
        COALESCE(by_path.stock_number, by_vin.stock_number, by_dx1.stock_number, by_lid.stock_number, by_stock.stock_number) AS stock_number,
        COALESCE(by_path.location, by_vin.location, by_dx1.location, by_lid.location, by_stock.location) AS location,
        COALESCE(by_path.first_seen, by_vin.first_seen, by_dx1.first_seen, by_lid.first_seen, by_stock.first_seen) AS first_seen,
        COALESCE(by_path.last_seen, by_vin.last_seen, by_dx1.last_seen, by_lid.last_seen, by_stock.last_seen) AS last_seen,
        COALESCE(by_path.raw_data, by_vin.raw_data, by_dx1.raw_data, by_lid.raw_data, by_stock.raw_data) AS raw_data
    ) iu
    ORDER BY u.client_id, u.report_date, u.page_path
  )
  SELECT
    m.client_id, m.ga4_property_id, m.account_name, m.report_date,
    m.page_location, m.page_path, m.page_title,
    m.views, m.total_users, m.sessions, m.new_users, m.ga4_page_type,
    m.customer_name AS hoot_customer_name, m.hoot_id, m.hoot_url, m.website_platform,
    m.sk AS inv_sk, m.vin AS inv_vin, m.url AS inv_url,
    m.make AS inv_make, m.model AS inv_model, m.year AS inv_year, m.trim AS inv_trim,
    m.price AS inv_price, m.msrp AS inv_msrp, m.condition AS inv_condition, m.type_ AS inv_type,
    COALESCE(
      NULLIF(TRIM(m.type_), ''),
      CASE WHEN m.inv_type_raw_key IS NULL THEN NULL
           ELSE NULLIF(TRIM(m.raw_data ->> m.inv_type_raw_key), '') END
    ) AS inv_custom_type,
    m.stock_number AS inv_stock_number, m.location AS inv_location,
    m.first_seen AS inv_first_seen, m.last_seen AS inv_last_seen,
    (m.page_path IS NOT NULL AND m.page_path <> '') AS vdp_conditions,
    CASE WHEN m.condition ILIKE 'new%' THEN 'New'
         WHEN m.condition ILIKE 'used%' THEN 'Used'
         WHEN m.condition ILIKE 'pre%' THEN 'Used'
         ELSE NULL END AS vdp_vehicle_condition,
    m.website_platform AS cms
  FROM matched m;

  IF NOT p_dry_run THEN
    DELETE FROM public.smart_final_data AS sfd
    WHERE sfd.client_id = v_client
      AND sfd.report_date BETWEEN v_from AND v_to;

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
    SELECT
      f.client_id, f.ga4_property_id, f.account_name, f.report_date,
      f.page_location, f.page_path, f.page_title,
      f.views, f.total_users, f.sessions, f.new_users, f.ga4_page_type,
      f.hoot_customer_name, f.hoot_id, f.hoot_url, f.website_platform,
      f.inv_sk, f.inv_vin, f.inv_url, f.inv_make, f.inv_model, f.inv_year, f.inv_trim,
      f.inv_price, f.inv_msrp, f.inv_condition, f.inv_type, f.inv_custom_type, f.inv_stock_number,
      f.inv_location, f.inv_first_seen, f.inv_last_seen,
      f.vdp_conditions, f.vdp_vehicle_condition, f.cms
    FROM _conner_final f;
  END IF;

  RETURN QUERY
  SELECT
    f.client_id::text,
    MAX(f.account_name)::text,
    MAX(f.cms)::text,
    COUNT(*)::bigint,
    COUNT(*) FILTER (WHERE f.inv_sk IS NOT NULL)::bigint,
    p_dry_run
  FROM _conner_final f
  GROUP BY f.client_id;
END;
$function$;

COMMENT ON FUNCTION public.build_smart_final_data_conner(text, integer, date, date, boolean) IS
  'Conner Step 3: smart_final_data from smart_conner_inventory (Hoot matching rules). Dry run by default.';

REVOKE ALL ON FUNCTION public.build_smart_final_data_conner(text, integer, date, date, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.build_smart_final_data_conner(text, integer, date, date, boolean)
  TO service_role;
