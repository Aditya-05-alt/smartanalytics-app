-- Channel breakdown: one row per GA4 session channel (no "Other" rollup).
-- Fast path when no inventory filters; VDP + filters use LEFT JOIN to smart_final_data.
-- Location match uses TRIM on both sides (dropdown values vs inv_location).
-- Run in Supabase SQL editor.

DROP FUNCTION IF EXISTS public.get_ga4_channel_breakdown(text, date, date, text);
DROP FUNCTION IF EXISTS public.get_ga4_channel_breakdown(
  text, date, date, text, text[], text[], text[], text, text[], text[], integer[], text[]
);

CREATE OR REPLACE FUNCTION public.get_ga4_channel_breakdown(
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
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_filter_active boolean;
  v_page_type     text := UPPER(COALESCE(p_page_type, 'ALL'));
  v_condition     text := UPPER(COALESCE(p_condition, 'BOTH'));
BEGIN
  v_filter_active :=
       COALESCE(array_length(p_types, 1), 0)     > 0
    OR COALESCE(array_length(p_classes, 1), 0)   > 0
    OR v_condition <> 'BOTH'
    OR COALESCE(array_length(p_makes, 1), 0)     > 0
    OR COALESCE(array_length(p_models, 1), 0)    > 0
    OR COALESCE(array_length(p_years, 1), 0)     > 0
    OR COALESCE(array_length(p_locations, 1), 0) > 0;

  RETURN QUERY
  WITH pages AS (
    SELECT
      p.channel,
      p.views,
      p.client_id,
      p.report_date,
      p.page_path,
      p.ga4_page_type
    FROM smart_ga4_page_data p
    WHERE p.client_id = p_client_id
      AND p.report_date BETWEEN p_from AND p_to
      AND (
        v_page_type = 'ALL'
        OR (v_page_type = 'VDP'   AND p.ga4_page_type ILIKE 'VDP%')
        OR (v_page_type = 'SRP'   AND p.ga4_page_type = 'SRP')
        OR (v_page_type = 'HOME'  AND p.ga4_page_type ILIKE 'home%')
        OR (v_page_type = 'OTHER' AND p.ga4_page_type NOT ILIKE 'VDP%'
                                  AND p.ga4_page_type <> 'SRP'
                                  AND p.ga4_page_type NOT ILIKE 'home%')
      )
      AND (p_channels IS NULL OR array_length(p_channels, 1) = 0
           OR p.channel = ANY(p_channels))
  ),
  combined AS (
    -- Branch 1: no inventory filters — return all pages directly
    SELECT p.channel, p.views
    FROM pages p
    WHERE NOT v_filter_active

    UNION ALL

    -- Branch 2: filters active, non-VDP pages — pass through (no inventory rows exist)
    SELECT p.channel, p.views
    FROM pages p
    WHERE v_filter_active
      AND p.ga4_page_type NOT ILIKE 'VDP%'

    UNION ALL

    -- Branch 3: filters active, VDP pages — LEFT JOIN so orphaned VDPs aren't lost
    SELECT p.channel, p.views
    FROM pages p
    LEFT JOIN smart_final_data s
      ON s.client_id   = p.client_id
     AND s.report_date = p.report_date
     AND s.page_path   = p.page_path
    WHERE v_filter_active
      AND p.ga4_page_type ILIKE 'VDP%'
      AND (
        COALESCE(array_length(p_locations, 1), 0) = 0
        OR (s.client_id IS NOT NULL
            AND TRIM(s.inv_location) = ANY(
              SELECT TRIM(loc) FROM unnest(p_locations) AS loc
            ))
      )
      AND (
        COALESCE(array_length(p_types, 1), 0) = 0
        OR (s.client_id IS NOT NULL AND s.inv_type = ANY(p_types))
      )
      AND (
        COALESCE(array_length(p_makes, 1), 0) = 0
        OR (s.client_id IS NOT NULL AND s.inv_make = ANY(p_makes))
      )
      AND (
        COALESCE(array_length(p_models, 1), 0) = 0
        OR (s.client_id IS NOT NULL AND s.inv_model = ANY(p_models))
      )
      AND (
        COALESCE(array_length(p_years, 1), 0) = 0
        OR (s.client_id IS NOT NULL
            AND s.inv_year ~ '^\d{4}$'
            AND s.inv_year::int = ANY(p_years))
      )
      AND (
        v_condition = 'BOTH'
        OR (s.client_id IS NOT NULL AND UPPER(s.inv_condition) = v_condition)
      )
      AND (
        COALESCE(array_length(p_classes, 1), 0) = 0
        OR (s.client_id IS NOT NULL AND (
          ('Class A' = ANY(p_classes) AND s.inv_type ILIKE '%class a%') OR
          ('Class B' = ANY(p_classes) AND s.inv_type ILIKE '%class b%') OR
          ('Class C' = ANY(p_classes) AND s.inv_type ILIKE '%class c%') OR
          ('Towable' = ANY(p_classes) AND (
              s.inv_type ILIKE '%travel trailer%'
           OR s.inv_type ILIKE '%fifth wheel%'
           OR s.inv_type ILIKE '%toy hauler%'
           OR s.inv_type ILIKE '%pop-up%'))
        ))
      )
  ),
  filtered AS (
    SELECT
      CASE lower(trim(COALESCE(c.channel, '')))
        WHEN 'organic_search'  THEN 'Organic Search'
        WHEN 'paid_search'     THEN 'Paid Search'
        WHEN 'direct'          THEN 'Direct'
        WHEN 'organic_social'  THEN 'Organic Social'
        WHEN 'paid_social'     THEN 'Paid Social'
        WHEN 'paid_video'      THEN 'Paid Video'
        WHEN 'organic_video'   THEN 'Organic Video'
        WHEN 'display'         THEN 'Display'
        WHEN 'email'           THEN 'Email'
        WHEN 'referral'        THEN 'Referral'
        WHEN 'affiliates'      THEN 'Affiliates'
        WHEN 'paid_other'      THEN 'Paid Other'
        WHEN 'sms'             THEN 'SMS'
        WHEN 'audio'           THEN 'Audio'
        WHEN 'cross-network'   THEN 'Cross-network'
        WHEN 'unassigned'      THEN 'Unassigned'
        WHEN ''                THEN '(not set)'
        ELSE initcap(replace(replace(lower(trim(c.channel)), '_', ' '), '-', ' '))
      END AS channel_bucket,
      c.views
    FROM combined c
  ),
  agg AS (
    SELECT f.channel_bucket, SUM(f.views)::bigint AS views
    FROM filtered f
    GROUP BY f.channel_bucket
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
  ORDER BY a.views DESC, a.channel_bucket;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_ga4_channel_breakdown(
  text, date, date, text, text[], text[], text[], text, text[], text[], integer[], text[]
) TO authenticated, service_role;
