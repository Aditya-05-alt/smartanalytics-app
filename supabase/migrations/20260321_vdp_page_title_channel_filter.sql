-- VDP tab: top page titles × channel columns.
-- Display title preference:
--   1) real GA4/final page_title (not blank, not a URL/path)
--   2) inventory-built title (Condition Year Make Model … | Location | #Stock)
--   3) humanized last path segment (never raw /full/url/path)
-- Paid Search = paid_search + cross_network + display.
-- Facebook = paid/organic social + facebook sources.
-- Deploy in Supabase SQL editor.

DROP FUNCTION IF EXISTS public.get_vdp_page_title_by_channel(
  text, date, date, int, text[], text[], text[], text[], integer[], text
);
DROP FUNCTION IF EXISTS public.get_vdp_page_title_by_channel(
  text, date, date, int, text[], text[], text[], text[], integer[], text, text[]
);

CREATE OR REPLACE FUNCTION public.get_vdp_page_title_by_channel(
  p_client_id text,
  p_from date,
  p_to date,
  p_limit int DEFAULT NULL,
  p_types text[] DEFAULT NULL,
  p_makes text[] DEFAULT NULL,
  p_models text[] DEFAULT NULL,
  p_locations text[] DEFAULT NULL,
  p_years integer[] DEFAULT NULL,
  p_condition text DEFAULT 'BOTH',
  p_channels text[] DEFAULT NULL
)
RETURNS TABLE (
  page_title text,
  page_path text,
  page_url text,
  organic_search bigint,
  direct bigint,
  paid_search bigint,
  facebook bigint,
  referral bigint,
  total_views bigint,
  rank int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH final_paths AS (
    SELECT
      s.client_id,
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
    WHERE s.client_id::text = trim(p_client_id)
      AND s.report_date BETWEEN p_from AND p_to
      AND s.vdp_conditions IS TRUE
      AND s.page_path IS NOT NULL
      AND TRIM(s.page_path) <> ''
      AND (COALESCE(array_length(p_types, 1), 0) = 0 OR s.inv_type = ANY(p_types))
      AND (COALESCE(array_length(p_makes, 1), 0) = 0 OR s.inv_make = ANY(p_makes))
      AND (COALESCE(array_length(p_models, 1), 0) = 0 OR s.inv_model = ANY(p_models))
      AND (COALESCE(array_length(p_locations, 1), 0) = 0 OR s.inv_location = ANY(p_locations))
      AND (
        COALESCE(array_length(p_years, 1), 0) = 0
        OR (s.inv_year ~ '^\d{4}$' AND s.inv_year::int = ANY(p_years))
      )
      AND (
        UPPER(COALESCE(p_condition, 'BOTH')) = 'BOTH'
        OR UPPER(s.inv_condition) = UPPER(p_condition)
      )
      AND public.vdp_final_matches_channels(
        trim(p_client_id), s.report_date, s.page_path, p_channels
      )
  ),
  -- One inventory/label row per path (best populated inventory wins)
  path_meta AS (
    SELECT DISTINCT ON (f.page_path)
      f.page_path,
      f.page_url,
      f.page_title AS final_page_title,
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
  joined AS (
    SELECT
      f.page_path,
      f.page_url,
      NULLIF(TRIM(p.page_title), '') AS ga4_page_title,
      regexp_replace(
        lower(trim(COALESCE(p.channel, ''))),
        '[\s/-]+',
        '_',
        'g'
      ) AS channel_raw,
      lower(trim(COALESCE(p.source, ''))) AS source_raw,
      COALESCE(p.views, 0)::bigint AS views
    FROM final_paths f
    JOIN public.smart_ga4_page_data p
      ON p.client_id = f.client_id
     AND p.report_date = f.report_date
     AND p.page_path = f.page_path
     AND (p.vdp_conditions IS TRUE OR p.ga4_page_type ILIKE 'VDP%')
     AND (
       COALESCE(array_length(p_channels, 1), 0) = 0
       OR public.vdp_channel_matches(p.channel, p_channels)
     )
  ),
  bucketed AS (
    SELECT
      j.page_path,
      j.page_url,
      j.ga4_page_title,
      CASE
        WHEN j.source_raw LIKE '%facebook%'
          OR j.source_raw LIKE '%fb%'
          OR j.channel_raw IN ('paid_social', 'organic_social')
          THEN 'facebook'
        WHEN j.channel_raw IN ('organic_search', 'organicsearch')
          THEN 'organic_search'
        WHEN j.channel_raw = 'direct'
          THEN 'direct'
        WHEN j.channel_raw IN (
          'paid_search',
          'paidsearch',
          'cross_network',
          'crossnetwork',
          'display'
        )
          THEN 'paid_search'
        WHEN j.channel_raw = 'referral'
          THEN 'referral'
        ELSE 'other'
      END AS bucket,
      j.views
    FROM joined j
  ),
  pivoted AS (
    SELECT
      b.page_path,
      MAX(NULLIF(TRIM(b.page_url), '')) AS page_url,
      -- Prefer clean English GA4 titles only (no CJK / Cyrillic / Greek / etc.)
      (
        ARRAY_AGG(
          b.ga4_page_title
          ORDER BY
            CASE
              WHEN b.ga4_page_title ~* '^(new|used)\s+[0-9]{4}\b' THEN 0
              WHEN b.ga4_page_title ~* '^(new|used)\b' THEN 1
              ELSE 2
            END,
            LENGTH(b.ga4_page_title) DESC
        ) FILTER (
          WHERE b.ga4_page_title IS NOT NULL
            AND b.ga4_page_title !~ '^https?://'
            AND b.ga4_page_title NOT LIKE '/%'
            -- ASCII only → drops Chinese / Greek / Cyrillic / Arabic / …
            AND b.ga4_page_title !~ '[^[:ascii:]]'
        )
      )[1] AS ga4_page_title,
      SUM(b.views) FILTER (WHERE b.bucket = 'organic_search')::bigint AS organic_search,
      SUM(b.views) FILTER (WHERE b.bucket = 'direct')::bigint AS direct,
      SUM(b.views) FILTER (WHERE b.bucket = 'paid_search')::bigint AS paid_search,
      SUM(b.views) FILTER (WHERE b.bucket = 'facebook')::bigint AS facebook,
      SUM(b.views) FILTER (WHERE b.bucket = 'referral')::bigint AS referral,
      SUM(b.views)::bigint AS total_views
    FROM bucketed b
    GROUP BY b.page_path
  ),
  labeled AS (
    SELECT
      p.page_path,
      COALESCE(p.page_url, m.page_url) AS page_url,
      COALESCE(p.organic_search, 0) AS organic_search,
      COALESCE(p.direct, 0) AS direct,
      COALESCE(p.paid_search, 0) AS paid_search,
      COALESCE(p.facebook, 0) AS facebook,
      COALESCE(p.referral, 0) AS referral,
      COALESCE(p.total_views, 0) AS total_views,
      COALESCE(
        -- 1) Clean English GA4 title
        NULLIF(TRIM(p.ga4_page_title), ''),
        -- 2) Clean English title from final (same ASCII check)
        CASE
          WHEN m.final_page_title IS NOT NULL
           AND m.final_page_title !~ '^https?://'
           AND m.final_page_title NOT LIKE '/%'
           AND m.final_page_title !~ '[^[:ascii:]]'
          THEN m.final_page_title
          ELSE NULL
        END,
        -- 3) Inventory-built English title (screenshot style)
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
                CASE
                  WHEN m.dealer_name IS NOT NULL THEN 'at ' || m.dealer_name
                  ELSE NULL
                END
              )),
              ''
            ),
            m.inv_location,
            CASE
              WHEN m.inv_stock_number IS NOT NULL THEN '#' || m.inv_stock_number
              ELSE NULL
            END
          )),
          ''
        ),
        -- 4) Humanize last path segment (ASCII slug)
        INITCAP(
          TRIM(
            regexp_replace(
              regexp_replace(
                regexp_replace(
                  regexp_replace(
                    COALESCE(
                      NULLIF(substring(m.page_path from '([^/]+)/?$'), ''),
                      m.page_path
                    ),
                    '[-_]+',
                    ' ',
                    'g'
                  ),
                  '\s+for sale\s*',
                  ' ',
                  'i'
                ),
                '\b(inventory|product|en|fr|new|used|vehicles?)\b',
                '',
                'gi'
              ),
              '\s+',
              ' ',
              'g'
            )
          )
        )
      ) AS page_title
    FROM pivoted p
    LEFT JOIN path_meta m ON m.page_path = p.page_path
    WHERE COALESCE(p.total_views, 0) > 0
  ),
  ranked AS (
    SELECT
      l.page_title,
      l.page_path,
      l.page_url,
      l.organic_search,
      l.direct,
      l.paid_search,
      l.facebook,
      l.referral,
      l.total_views,
      ROW_NUMBER() OVER (ORDER BY l.total_views DESC, l.page_title ASC)::int AS rank
    FROM labeled l
  )
  SELECT
    r.page_title,
    r.page_path,
    r.page_url,
    r.organic_search,
    r.direct,
    r.paid_search,
    r.facebook,
    r.referral,
    r.total_views,
    r.rank
  FROM ranked r
  WHERE p_limit IS NULL OR r.rank <= p_limit
  ORDER BY r.rank;
$$;

COMMENT ON FUNCTION public.get_vdp_page_title_by_channel(
  text, date, date, int, text[], text[], text[], text[], integer[], text, text[]
) IS
  'VDP page×channel matrix. Titles: clean ASCII English only (drops CJK/Cyrillic/Greek); else inventory/path. Paid Search = paid+cross+display.';

REVOKE ALL ON FUNCTION public.get_vdp_page_title_by_channel(
  text, date, date, int, text[], text[], text[], text[], integer[], text, text[]
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_vdp_page_title_by_channel(
  text, date, date, int, text[], text[], text[], text[], integer[], text, text[]
) TO anon, authenticated, service_role;
