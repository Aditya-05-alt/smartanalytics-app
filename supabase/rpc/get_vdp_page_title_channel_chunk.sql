-- VDP tab: page title × channel matrix, per date window (no ranking / limit).
-- Client calls this in small date chunks and merges by page_path, then ranks.
-- Title preference: clean ASCII final page_title ("New/Used YYYY …" first, then longest)
--   → inventory-built title → humanized slug.
-- Paid Search = paid_search + cross_network. Display is its own column.
-- Facebook = paid/organic social + facebook sources.

CREATE OR REPLACE FUNCTION public.get_vdp_page_title_channel_chunk(
  p_client_id text,
  p_from date,
  p_to date,
  p_types text[] DEFAULT NULL,
  p_makes text[] DEFAULT NULL,
  p_models text[] DEFAULT NULL,
  p_locations text[] DEFAULT NULL,
  p_years integer[] DEFAULT NULL,
  p_condition text DEFAULT 'BOTH',
  p_channels text[] DEFAULT NULL,
  p_ga4_property_id text DEFAULT NULL
)
RETURNS TABLE (
  page_title text,
  page_path text,
  page_url text,
  title_date date,
  organic_search bigint,
  direct bigint,
  paid_search bigint,
  display bigint,
  facebook bigint,
  referral bigint,
  total_views bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
-- Planner row estimates here are unreliable (per-dealer skew, OR-with-NULL filters),
-- and nested-loop / merge joins over smart_ga4_page_data blow up to 25–40s per chunk.
-- Hash joins only, and EXECUTE … USING so NULL filters fold away like literals.
SET search_path = public
SET enable_nestloop = off
SET enable_mergejoin = off
AS $$
DECLARE
  -- Plain column equality keeps estimates accurate
  -- (ga4_property_scope_matches() hides the column from statistics).
  v_prop text := NULLIF(btrim(p_ga4_property_id), '');
BEGIN
  RETURN QUERY EXECUTE $q$
  WITH final_paths AS (
    SELECT
      s.report_date,
      s.page_path,
      NULLIF(TRIM(s.page_title), '') AS page_title,
      CASE
        WHEN NULLIF(TRIM(s.inv_url), '') ~* '^https?://' THEN TRIM(s.inv_url)
        WHEN NULLIF(TRIM(s.page_location), '') ~* '^https?://'
             AND TRIM(s.page_location) !~* 'hootinteractive\.net' THEN TRIM(s.page_location)
        ELSE NULL
      END AS page_url,
      NULLIF(TRIM(s.inv_condition), '') AS inv_condition,
      NULLIF(TRIM(s.inv_year), '') AS inv_year,
      NULLIF(TRIM(s.inv_make), '') AS inv_make,
      NULLIF(TRIM(s.inv_model), '') AS inv_model,
      NULLIF(TRIM(s.inv_trim), '') AS inv_trim,
      NULLIF(TRIM(s.inv_type), '') AS inv_type,
      NULLIF(TRIM(s.inv_location), '') AS inv_location,
      NULLIF(TRIM(s.inv_stock_number), '') AS inv_stock_number,
      COALESCE(
        NULLIF(TRIM(s.hoot_customer_name), ''),
        NULLIF(TRIM(s.account_name), '')
      ) AS dealer_name
    FROM public.smart_final_data s
    WHERE s.client_id::text = $1
      AND ($11::text IS NULL OR s.ga4_property_id = $11)
      AND s.report_date BETWEEN $2 AND $3
      AND s.vdp_conditions IS TRUE
      AND s.page_path IS NOT NULL
      AND TRIM(s.page_path) <> ''
      AND (COALESCE(array_length($4, 1), 0) = 0 OR s.inv_type = ANY($4))
      AND (COALESCE(array_length($5, 1), 0) = 0 OR s.inv_make = ANY($5))
      AND (COALESCE(array_length($6, 1), 0) = 0 OR s.inv_model = ANY($6))
      AND (COALESCE(array_length($7, 1), 0) = 0 OR s.inv_location = ANY($7))
      AND (
        COALESCE(array_length($8, 1), 0) = 0
        OR (s.inv_year ~ '^\d{4}$' AND s.inv_year::int = ANY($8))
      )
      AND public.vdp_condition_matches(s.inv_condition, $9)
  ),
  final_keys AS (
    SELECT DISTINCT f.report_date, f.page_path
    FROM final_paths f
  ),
  best_title AS (
    SELECT DISTINCT ON (f.page_path)
      f.page_path,
      f.page_title
    FROM final_paths f
    WHERE f.page_title IS NOT NULL
      AND f.page_title !~ '^https?://'
      AND f.page_title NOT LIKE '/%'
      AND translate(f.page_title, '®™©', '') !~ '[^[:ascii:]]'
    ORDER BY
      f.page_path,
      CASE
        WHEN f.page_title ~* '^(new|used)\s+[0-9]{4}\b' THEN 0
        WHEN f.page_title ~* '^(new|used)\b' THEN 1
        ELSE 2
      END,
      LENGTH(f.page_title) DESC
  ),
  path_meta AS (
    SELECT DISTINCT ON (f.page_path)
      f.page_path,
      f.report_date,
      f.page_url,
      f.inv_condition,
      f.inv_year,
      f.inv_make,
      f.inv_model,
      f.inv_trim,
      f.inv_type,
      f.inv_location,
      f.inv_stock_number,
      f.dealer_name
    FROM final_paths f
    ORDER BY
      f.page_path,
      (
        (f.inv_make IS NOT NULL)::int
        + (f.inv_model IS NOT NULL)::int
        + (f.inv_year IS NOT NULL)::int
        + (f.inv_condition IS NOT NULL)::int
        + (f.page_title IS NOT NULL)::int
      ) DESC,
      f.report_date DESC
  ),
  -- QS dealers match Final on page_path_q_s; everyone else on page_path.
  ga4 AS (
    SELECT
      p.report_date,
      COALESCE(NULLIF(TRIM(p.page_path_q_s), ''), p.page_path) AS jpath,
      regexp_replace(lower(trim(COALESCE(p.channel, ''))), '[\s/-]+', '_', 'g') AS channel_raw,
      lower(trim(COALESCE(p.source, ''))) AS source_raw,
      COALESCE(p.views, 0)::bigint AS views
    FROM public.smart_ga4_page_data p
    WHERE p.client_id = $1
      AND p.report_date BETWEEN $2 AND $3
      AND (p.vdp_conditions IS TRUE OR p.ga4_page_type ILIKE 'VDP%')
      AND ($11::text IS NULL OR p.ga4_property_id = $11)
      AND (
        COALESCE(array_length($10, 1), 0) = 0
        OR public.vdp_channel_matches(p.channel, $10)
      )
  ),
  bucketed AS (
    SELECT
      k.page_path,
      CASE
        WHEN g.source_raw LIKE '%facebook%'
          OR g.source_raw LIKE '%fb%'
          OR g.channel_raw IN ('paid_social', 'organic_social')
          THEN 'facebook'
        WHEN g.channel_raw IN ('organic_search', 'organicsearch') THEN 'organic_search'
        WHEN g.channel_raw = 'direct' THEN 'direct'
        WHEN g.channel_raw = 'display' THEN 'display'
        WHEN g.channel_raw IN ('paid_search', 'paidsearch', 'cross_network', 'crossnetwork')
          THEN 'paid_search'
        WHEN g.channel_raw = 'referral' THEN 'referral'
        ELSE 'other'
      END AS bucket,
      g.views
    FROM ga4 g
    JOIN final_keys k
      ON k.report_date = g.report_date
     AND k.page_path = g.jpath
  ),
  pivoted AS (
    SELECT
      b.page_path,
      SUM(b.views) FILTER (WHERE b.bucket = 'organic_search')::bigint AS organic_search,
      SUM(b.views) FILTER (WHERE b.bucket = 'direct')::bigint AS direct,
      SUM(b.views) FILTER (WHERE b.bucket = 'paid_search')::bigint AS paid_search,
      SUM(b.views) FILTER (WHERE b.bucket = 'display')::bigint AS display,
      SUM(b.views) FILTER (WHERE b.bucket = 'facebook')::bigint AS facebook,
      SUM(b.views) FILTER (WHERE b.bucket = 'referral')::bigint AS referral,
      SUM(b.views)::bigint AS total_views
    FROM bucketed b
    GROUP BY b.page_path
    HAVING SUM(b.views) > 0
  )
  SELECT
    COALESCE(
      t.page_title,
      NULLIF(
        TRIM(BOTH ' |' FROM CONCAT_WS(
          ' | ',
          NULLIF(
            TRIM(CONCAT_WS(
              ' ',
              CASE
                WHEN m.inv_condition ILIKE 'new%' THEN 'New'
                WHEN m.inv_condition ILIKE 'used%' OR m.inv_condition ILIKE 'pre%' THEN 'Used'
                ELSE INITCAP(LOWER(m.inv_condition))
              END,
              m.inv_year,
              m.inv_make,
              m.inv_model,
              m.inv_trim,
              m.inv_type,
              CASE WHEN m.dealer_name IS NOT NULL THEN 'at ' || m.dealer_name ELSE NULL END
            )),
            ''
          ),
          m.inv_location,
          CASE WHEN m.inv_stock_number IS NOT NULL THEN '#' || m.inv_stock_number ELSE NULL END
        )),
        ''
      ),
      INITCAP(
        TRIM(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                regexp_replace(
                  COALESCE(NULLIF(substring(m.page_path from '([^/]+)/?$'), ''), m.page_path),
                  '[-_]+', ' ', 'g'
                ),
                '\s+for sale\s*', ' ', 'i'
              ),
              '\b(inventory|product|en|fr|new|used|vehicles?)\b', '', 'gi'
            ),
            '\s+', ' ', 'g'
          )
        )
      )
    ) AS page_title,
    p.page_path,
    m.page_url,
    m.report_date AS title_date,
    COALESCE(p.organic_search, 0),
    COALESCE(p.direct, 0),
    COALESCE(p.paid_search, 0),
    COALESCE(p.display, 0),
    COALESCE(p.facebook, 0),
    COALESCE(p.referral, 0),
    COALESCE(p.total_views, 0)
  FROM pivoted p
  JOIN path_meta m ON m.page_path = p.page_path
  LEFT JOIN best_title t ON t.page_path = p.page_path
  $q$
  USING trim(p_client_id), p_from, p_to, p_types, p_makes, p_models,
        p_locations, p_years, p_condition, p_channels, v_prop;
END;
$$;

COMMENT ON FUNCTION public.get_vdp_page_title_channel_chunk(
  text, date, date, text[], text[], text[], text[], integer[], text, text[], text
) IS
  'VDP page×channel per date window (client merges chunks + ranks). Paid Search = paid+cross network; Display separate.';

REVOKE ALL ON FUNCTION public.get_vdp_page_title_channel_chunk(
  text, date, date, text[], text[], text[], text[], integer[], text, text[], text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_vdp_page_title_channel_chunk(
  text, date, date, text[], text[], text[], text[], integer[], text, text[], text
) TO anon, authenticated, service_role;
