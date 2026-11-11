-- VDP Analysis: one dealer's in-stock units for a date range, with VDP views per channel.
--   In stock on day d = unit in that day's inventory snapshot:
--     smart_hoot_inventory_daily before the dealer's first Conner snapshot, smart_conner_inventory from then on.
--   Units are keyed by stock number (VIN when missing): the Hoot feed stores the stock number in its vin
--     field while Conner has the real VIN, so stock number is the only key shared by both feeds and Final.
--   Unit VDP views = smart_final_data views matched to a unit in stock that day; the rest are returned as
--     viewsUnmatched (sold / not in the feed that day).
--   Channels: each page's Final views split by that page's GA4 VDP views per channel (same as Event Tracking),
--     grouped into the dashboard's 8 channel groups.

CREATE OR REPLACE FUNCTION public.get_vdp_analysis(p_client_id text, p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '55s'
AS $$
DECLARE
  v_name text;
  v_conner date;
  v_result jsonb;
BEGIN
  SELECT h.customer_name INTO v_name
  FROM smart_hoot_config h
  WHERE h.is_active AND btrim(h.ga4_customer_id) = btrim(p_client_id)
  LIMIT 1;
  IF v_name IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT min(c.update_date) INTO v_conner FROM smart_conner_inventory c WHERE c.customer_name = v_name;

  WITH snap AS (
    SELECT h.pull_date AS d,
           upper(btrim(COALESCE(NULLIF(btrim(h.stock_number), ''), h.vin))) AS uk,
           upper(btrim(h.vin)) AS vin, h.condition, h.year, h.make, h.model, h.url
    FROM smart_hoot_inventory_daily h
    WHERE h.customer_name = v_name
      AND h.pull_date BETWEEN p_from AND p_to
      AND (v_conner IS NULL OR h.pull_date < v_conner)
      AND COALESCE(NULLIF(btrim(h.stock_number), ''), NULLIF(btrim(h.vin), '')) IS NOT NULL
    UNION ALL
    SELECT c.update_date,
           upper(btrim(COALESCE(NULLIF(btrim(c.stock_number), ''), c.vin))),
           upper(btrim(c.vin)), c.condition, c.year, c.make, c.model, c.url
    FROM smart_conner_inventory c
    WHERE v_conner IS NOT NULL
      AND c.customer_name = v_name
      AND c.update_date BETWEEN GREATEST(p_from, v_conner) AND p_to
      AND COALESCE(NULLIF(btrim(c.stock_number), ''), NULLIF(btrim(c.vin), '')) IS NOT NULL
  ),
  instock AS (SELECT DISTINCT d, uk FROM snap),
  first_listed AS (
    SELECT uk, min(d) AS first_d
    FROM (
      SELECT upper(btrim(COALESCE(NULLIF(btrim(h.stock_number), ''), h.vin))) AS uk, h.pull_date AS d
      FROM smart_hoot_inventory_daily h
      WHERE h.customer_name = v_name AND h.pull_date <= p_to
      UNION ALL
      SELECT upper(btrim(COALESCE(NULLIF(btrim(c.stock_number), ''), c.vin))), c.update_date
      FROM smart_conner_inventory c
      WHERE c.customer_name = v_name AND c.update_date <= p_to
    ) x
    WHERE uk IS NOT NULL AND uk <> ''
    GROUP BY uk
  ),
  page_channels AS (
    SELECT p.report_date,
           COALESCE(btrim(p.page_path), '') AS page_path,
           CASE WHEN n.ch IN ('Paid Social', 'Paid Search', 'Organic Search', 'Direct', 'Cross-network',
                              'Organic Social', 'Referral')
                THEN n.ch ELSE 'Other' END AS channel,
           COALESCE(p.views, 0) AS views,
           p.vdp_conditions IS TRUE AS is_vdp
    FROM smart_ga4_page_data p
    CROSS JOIN LATERAL (SELECT public.event_tracking_channel_name(p.channel) AS ch) n
    WHERE p.client_id = p_client_id AND p.report_date BETWEEN p_from AND p_to
  ),
  weights AS (
    SELECT report_date, page_path, channel, SUM(views) AS cv
    FROM page_channels
    WHERE is_vdp
    GROUP BY 1, 2, 3
    HAVING SUM(views) > 0
  ),
  fin AS (
    SELECT f.report_date,
           COALESCE(btrim(f.page_path), '') AS page_path,
           upper(btrim(COALESCE(NULLIF(btrim(f.inv_stock_number), ''), f.inv_vin))) AS uk,
           max(f.inv_condition) AS inv_condition,
           SUM(COALESCE(f.views, 0)) AS views
    FROM smart_final_data f
    WHERE f.client_id = p_client_id AND f.report_date BETWEEN p_from AND p_to
    GROUP BY 1, 2, 3
  ),
  alloc AS (
    SELECT fin.uk,
           COALESCE(w.channel, 'Other') AS channel,
           fin.views * COALESCE(
             w.cv::numeric / NULLIF(SUM(w.cv) OVER (PARTITION BY fin.report_date, fin.page_path, fin.uk), 0),
             1
           ) AS v,
           (i.uk IS NOT NULL) AS in_stock
    FROM fin
    LEFT JOIN weights w ON w.report_date = fin.report_date AND w.page_path = fin.page_path
    LEFT JOIN instock i ON i.d = fin.report_date AND i.uk = fin.uk
  ),
  unit_channels AS (
    SELECT uk, jsonb_object_agg(channel, round(v)) AS ch
    FROM (SELECT uk, channel, SUM(v) AS v FROM alloc WHERE in_stock GROUP BY 1, 2) x
    WHERE round(v) > 0
    GROUP BY uk
  ),
  fin_condition AS (SELECT uk, max(inv_condition) AS c FROM fin WHERE uk IS NOT NULL GROUP BY uk),
  units AS (
    SELECT s.uk,
           (array_agg(s.vin ORDER BY s.d DESC) FILTER (WHERE length(s.vin) = 17))[1] AS vin,
           (array_agg(s.condition ORDER BY s.d DESC) FILTER (WHERE NULLIF(btrim(s.condition), '') IS NOT NULL))[1] AS cond,
           (array_agg(s.year ORDER BY s.d DESC))[1] AS year,
           (array_agg(s.make ORDER BY s.d DESC))[1] AS make,
           (array_agg(s.model ORDER BY s.d DESC))[1] AS model,
           (array_agg(s.url ORDER BY s.d DESC))[1] AS url,
           count(DISTINCT s.d) AS days_listed,
           max(s.d) AS last_d
    FROM snap s
    GROUP BY s.uk
  )
  SELECT jsonb_build_object(
    'dealer', v_name,
    'connerFrom', v_conner,
    'snapshotDays', (SELECT count(DISTINCT d) FROM snap),
    'viewsInStock', COALESCE((SELECT round(SUM(v)) FROM alloc WHERE in_stock), 0),
    'viewsUnmatched', COALESCE((SELECT round(SUM(v)) FROM alloc WHERE NOT in_stock), 0),
    'channelPageViews', COALESCE((
      SELECT jsonb_object_agg(channel, jsonb_build_object('all', all_views, 'vdp', vdp_views))
      FROM (
        SELECT channel, SUM(views) AS all_views, SUM(views) FILTER (WHERE is_vdp) AS vdp_views
        FROM page_channels GROUP BY channel
      ) x
    ), '{}'::jsonb),
    'units', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', u.uk,
        'vin', u.vin,
        'condition', CASE
          WHEN COALESCE(u.cond, fc.c, '') ~* '^\s*new' THEN 'N'
          WHEN NULLIF(btrim(COALESCE(u.cond, fc.c, '')), '') IS NOT NULL THEN 'U'
          WHEN u.url ~* '[/_-]new[/_-]' THEN 'N'
          ELSE 'U'
        END,
        'year', u.year,
        'make', u.make,
        'model', u.model,
        'url', u.url,
        'daysListed', u.days_listed,
        'daysInStock', (u.last_d - fl.first_d) + 1,
        'channels', COALESCE(uc.ch, '{}'::jsonb)
      ) ORDER BY u.uk)
      FROM units u
      LEFT JOIN unit_channels uc USING (uk)
      LEFT JOIN fin_condition fc USING (uk)
      LEFT JOIN first_listed fl USING (uk)
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_vdp_analysis(text, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_vdp_analysis(text, date, date) TO service_role;
