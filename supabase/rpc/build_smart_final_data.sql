-- Deploy in Supabase SQL editor. Called by Admin Pipeline Step 3 (build_smart_final_data).
-- Prefer p_date_from / p_date_to (matches UI From → To). Falls back to p_days_back.

CREATE OR REPLACE FUNCTION public.build_smart_final_data(
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
AS $$
BEGIN
  -- Qualify columns: RETURNS TABLE (client_id ...) shadows bare names in PL/pgSQL.
  DELETE FROM public.smart_final_data AS sfd
  WHERE (p_client_id IS NULL OR sfd.client_id = p_client_id)
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
    inv_price, inv_msrp, inv_condition, inv_type, inv_stock_number,
    inv_location, inv_first_seen, inv_last_seen,
    vdp_conditions, vdp_vehicle_condition, cms
  )
  WITH ga4_unique AS (
    SELECT
      g.client_id,
      MAX(g.ga4_property_id)               AS ga4_property_id,
      MAX(g.account_name)                  AS account_name,
      g.report_date,
      g.page_path,
      MAX(g.page_location)                 AS page_location,
      MAX(g.page_title)                    AS page_title,
      MAX(g.ga4_page_type)                 AS ga4_page_type,
      COALESCE(SUM(g.views), 0)::INT       AS views,
      COALESCE(SUM(g.total_users), 0)::INT AS total_users,
      COALESCE(SUM(g.sessions), 0)::INT    AS sessions,
      COALESCE(SUM(g.new_users), 0)::INT   AS new_users
    FROM public.smart_ga4_page_data g
    WHERE g.vdp_conditions = TRUE
      AND (p_client_id IS NULL OR g.client_id = p_client_id)
      AND (p_date_from IS NULL OR g.report_date >= p_date_from)
      AND (p_date_to IS NULL OR g.report_date <= p_date_to)
      AND (
        p_date_from IS NOT NULL
        OR p_days_back IS NULL
        OR g.report_date >= CURRENT_DATE - p_days_back
      )
    GROUP BY g.client_id, g.report_date, g.page_path
  ),
  config_unique AS (
    SELECT DISTINCT ON (h.ga4_customer_id)
      h.ga4_customer_id,
      h.customer_name,
      h.hoot_id,
      h.hoot_url,
      h.website_platform
    FROM public.smart_hoot_config h
    WHERE h.ga4_customer_id IS NOT NULL
    ORDER BY h.ga4_customer_id, h.id DESC
  ),
  inv_norm AS (
    SELECT DISTINCT ON (i.customer_name, LOWER(TRIM(i.url)))
      i.customer_name,
      LOWER(TRIM(i.url)) AS url_lower,
      i.sk, i.vin, i.url, i.make, i.model, i.year, i.trim,
      i.price, i.msrp, i.condition, i.type_, i.stock_number,
      i.location, i.first_seen, i.last_seen
    FROM public.smart_hoot_inventory i
    WHERE i.url IS NOT NULL
      AND i.url <> ''
    ORDER BY i.customer_name, LOWER(TRIM(i.url)),
             i.last_seen DESC NULLS LAST,
             i.first_seen DESC NULLS LAST
  ),
  matched AS (
    SELECT DISTINCT ON (u.client_id, u.report_date, u.page_path)
      u.*,
      c.customer_name,
      c.hoot_id,
      c.hoot_url,
      c.website_platform,
      iu.sk, iu.vin, iu.url, iu.make, iu.model, iu.year, iu.trim,
      iu.price, iu.msrp, iu.condition, iu.type_, iu.stock_number,
      iu.location, iu.first_seen, iu.last_seen
    FROM ga4_unique u
    LEFT JOIN config_unique c
           ON c.ga4_customer_id = u.client_id
    LEFT JOIN inv_norm iu
           ON iu.customer_name = c.customer_name
          AND u.page_path IS NOT NULL
          AND u.page_path <> ''
          AND iu.url_lower LIKE '%' || LOWER(TRIM(u.page_path)) || '%'
    ORDER BY u.client_id, u.report_date, u.page_path,
             LENGTH(iu.url_lower) DESC NULLS LAST
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
  WHERE (p_client_id IS NULL OR s.client_id = p_client_id)
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

GRANT EXECUTE ON FUNCTION public.build_smart_final_data(text, integer, date, date)
  TO service_role;
