-- LAB ONLY — Channel breakdown with the SAME filtered universe as
-- get_year_breakdown / get_vdp_views_by_date / get_condition_breakdown.
--
-- Why Channel was 0 while Year showed ~8k for Frederick/Stuart:
--   Year sums smart_final_data.views (location filter works).
--   Old lab channel INNER JOIN'd GA4 by path — no match ⇒ empty.
--
-- Fix:
--   1) Filter final exactly like Year (incl. vdp_location_filter_match)
--   2) LEFT JOIN ga4 channels on client_id::text + date + page_path
--   3) Paths with no GA4 rows → "Unassigned" using final.views
--      so Channel TOTAL ≈ Year/Condition TOTAL
--
-- Live get_ga4_channel_breakdown untouched.
-- Requires: vdp_location_filter_match.sql
-- Deploy in Supabase SQL editor (REPLACE the old lab function).

DROP FUNCTION IF EXISTS public.get_ga4_channel_breakdown_lab(text, date, date, text);
DROP FUNCTION IF EXISTS public.get_ga4_channel_breakdown_lab(
  text, date, date, text, text[], text[], text[], text, text[], text[], integer[], text[]
);

CREATE OR REPLACE FUNCTION public.get_ga4_channel_breakdown_lab(
  p_client_id   text,
  p_from        date,
  p_to          date,
  p_page_type   text      DEFAULT 'ALL',
  p_channels    text[]    DEFAULT NULL,
  p_types       text[]    DEFAULT NULL,
  p_classes     text[]    DEFAULT NULL,
  p_condition   text      DEFAULT 'BOTH',
  p_makes       text[]    DEFAULT NULL,
  p_models      text[]    DEFAULT NULL,
  p_years       integer[] DEFAULT NULL,
  p_locations   text[]    DEFAULT NULL
)
RETURNS TABLE (
  channel_bucket text,
  views          bigint,
  pct            numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH params AS (
    SELECT
      trim(p_client_id) AS client_id,
      UPPER(COALESCE(p_page_type, 'ALL')) AS page_type,
      UPPER(COALESCE(p_condition, 'BOTH')) AS condition
  ),

  -- EXACT same filter room as get_year_breakdown / get_vdp_views_by_date
  filtered_final AS (
    SELECT
      f.client_id::text AS client_id,
      f.report_date,
      NULLIF(TRIM(f.page_path), '') AS page_path,
      SUM(COALESCE(f.views, 0))::bigint AS views
    FROM public.smart_final_data f
    CROSS JOIN params p
    WHERE p.page_type = 'VDP'
      AND f.client_id::text = p.client_id
      AND f.report_date BETWEEN p_from AND p_to
      AND (COALESCE(array_length(p_types, 1), 0) = 0 OR f.inv_type = ANY(p_types))
      AND (COALESCE(array_length(p_makes, 1), 0) = 0 OR f.inv_make = ANY(p_makes))
      AND (COALESCE(array_length(p_models, 1), 0) = 0 OR f.inv_model = ANY(p_models))
      AND (
        COALESCE(array_length(p_locations, 1), 0) = 0
        OR public.vdp_location_filter_match(p.client_id, f.inv_location, p_locations)
      )
      AND (
        COALESCE(array_length(p_years, 1), 0) = 0
        OR (f.inv_year ~ '^\d{4}$' AND f.inv_year::int = ANY(p_years))
      )
      AND (
        p.condition = 'BOTH'
        OR UPPER(f.inv_condition) = p.condition
      )
      AND (
        COALESCE(array_length(p_classes, 1), 0) = 0
        OR (
          ('Class A' = ANY(p_classes) AND f.inv_type ILIKE '%class a%') OR
          ('Class B' = ANY(p_classes) AND f.inv_type ILIKE '%class b%') OR
          ('Class C' = ANY(p_classes) AND f.inv_type ILIKE '%class c%') OR
          ('Towable' = ANY(p_classes) AND (
              f.inv_type ILIKE '%travel trailer%'
           OR f.inv_type ILIKE '%fifth wheel%'
           OR f.inv_type ILIKE '%toy hauler%'
           OR f.inv_type ILIKE '%pop-up%'))
        )
      )
    GROUP BY f.client_id::text, f.report_date, NULLIF(TRIM(f.page_path), '')
    HAVING SUM(COALESCE(f.views, 0)) > 0
  ),

  -- GA4 channels for those paths (LEFT JOIN — keep final rows even if no channel)
  channel_hits AS (
    SELECT
      COALESCE(NULLIF(TRIM(g.channel), ''), 'Unassigned') AS channel,
      g.views::bigint AS views
    FROM filtered_final f
    INNER JOIN public.smart_ga4_page_data g
      ON g.client_id::text = f.client_id
     AND g.report_date = f.report_date
     AND NULLIF(TRIM(g.page_path), '') = f.page_path
    WHERE f.page_path IS NOT NULL
      AND (p_channels IS NULL OR array_length(p_channels, 1) = 0
           OR g.channel = ANY(p_channels))

    UNION ALL

    -- No GA4 channel row for this path/date → keep final.views (matches Year total)
    SELECT
      'Unassigned'::text AS channel,
      f.views
    FROM filtered_final f
    WHERE f.views > 0
      AND (
        f.page_path IS NULL
        OR NOT EXISTS (
          SELECT 1
          FROM public.smart_ga4_page_data g
          WHERE g.client_id::text = f.client_id
            AND g.report_date = f.report_date
            AND NULLIF(TRIM(g.page_path), '') = f.page_path
        )
      )

    UNION ALL

    -- Non-VDP page types: plain GA4 (no inventory/location)
    SELECT
      COALESCE(NULLIF(TRIM(g.channel), ''), 'Unassigned') AS channel,
      g.views::bigint AS views
    FROM public.smart_ga4_page_data g
    CROSS JOIN params p
    WHERE p.page_type <> 'VDP'
      AND g.client_id::text = p.client_id
      AND g.report_date BETWEEN p_from AND p_to
      AND (
        p.page_type = 'ALL'
        OR (p.page_type = 'SRP'   AND g.ga4_page_type = 'SRP')
        OR (p.page_type = 'HOME'  AND g.ga4_page_type ILIKE 'home%')
        OR (p.page_type = 'OTHER' AND g.ga4_page_type NOT ILIKE 'VDP%'
                                  AND g.ga4_page_type <> 'SRP'
                                  AND g.ga4_page_type NOT ILIKE 'home%')
      )
      AND (p_channels IS NULL OR array_length(p_channels, 1) = 0
           OR g.channel = ANY(p_channels))
  ),

  mapped AS (
    SELECT
      CASE lower(trim(COALESCE(h.channel, '')))
        WHEN 'organic_search'  THEN 'Organic Search'
        WHEN 'organic search'  THEN 'Organic Search'
        WHEN 'paid_search'     THEN 'Paid Search'
        WHEN 'paid search'     THEN 'Paid Search'
        WHEN 'direct'          THEN 'Direct'
        WHEN 'organic_social'  THEN 'Organic Social'
        WHEN 'organic social'  THEN 'Organic Social'
        WHEN 'paid_social'     THEN 'Paid Social'
        WHEN 'paid social'     THEN 'Paid Social'
        WHEN 'paid_video'      THEN 'Paid Video'
        WHEN 'paid video'      THEN 'Paid Video'
        WHEN 'organic_video'   THEN 'Organic Video'
        WHEN 'organic video'   THEN 'Organic Video'
        WHEN 'display'         THEN 'Display'
        WHEN 'email'           THEN 'Email'
        WHEN 'referral'        THEN 'Referral'
        WHEN 'affiliates'      THEN 'Affiliates'
        WHEN 'paid_other'      THEN 'Paid Other'
        WHEN 'paid other'      THEN 'Paid Other'
        WHEN 'sms'             THEN 'SMS'
        WHEN 'audio'           THEN 'Audio'
        WHEN 'cross-network'   THEN 'Cross-network'
        WHEN 'cross_network'   THEN 'Cross-network'
        WHEN 'unassigned'      THEN 'Unassigned'
        WHEN 'ai assistant'    THEN 'AI Assistant'
        WHEN 'ai_assistant'    THEN 'AI Assistant'
        WHEN ''                THEN 'Unassigned'
        ELSE initcap(replace(replace(lower(trim(h.channel)), '_', ' '), '-', ' '))
      END AS channel_bucket,
      h.views
    FROM channel_hits h
  ),
  agg AS (
    SELECT m.channel_bucket, SUM(m.views)::bigint AS views
    FROM mapped m
    GROUP BY m.channel_bucket
  ),
  grand AS (
    SELECT NULLIF(SUM(a.views), 0)::numeric AS total FROM agg a
  )
  SELECT
    a.channel_bucket,
    a.views,
    ROUND(100.0 * a.views / g.total, 2) AS pct
  FROM agg a
  CROSS JOIN grand g
  WHERE a.views > 0
    AND g.total IS NOT NULL
  ORDER BY a.views DESC, a.channel_bucket;
$$;

COMMENT ON FUNCTION public.get_ga4_channel_breakdown_lab(
  text, date, date, text, text[], text[], text[], text, text[], text[], integer[], text[]
) IS
  'VDP Lab channel: same filters as Year/KPI; GA4 channels + Unassigned fallback from final.views.';

REVOKE ALL ON FUNCTION public.get_ga4_channel_breakdown_lab(
  text, date, date, text, text[], text[], text[], text, text[], text[], integer[], text[]
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_ga4_channel_breakdown_lab(
  text, date, date, text, text[], text[], text[], text, text[], text[], integer[], text[]
) TO anon, authenticated, service_role;
