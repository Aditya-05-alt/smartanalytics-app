-- VDP Analysis fast path: precomputed daily tables, filled by refresh_vdp_analysis(client, from, to).
--   Computing units straight from smart_ga4_page_data / Final / both inventory feeds takes 20s+ for the
--   larger dealers, so get_vdp_analysis now only reads these tables. Same rules as 20261110_vdp_analysis_units:
--   Hoot feed before the dealer's first Conner snapshot, Conner from then on (scraped site inventory for dealers
--   with neither feed in the range); units keyed by stock number;
--   Final views split across channels by each page's GA4 VDP views per channel.

CREATE TABLE IF NOT EXISTS public.smart_vdp_inventory_daily (
  client_id text NOT NULL,
  d date NOT NULL,
  uk text NOT NULL,
  vin text,
  condition text,
  year text,
  make text,
  model text,
  url text,
  PRIMARY KEY (client_id, d, uk)
);

CREATE TABLE IF NOT EXISTS public.smart_vdp_unit_views_daily (
  client_id text NOT NULL,
  report_date date NOT NULL,
  uk text NOT NULL,
  channel text NOT NULL,
  views numeric NOT NULL,
  in_stock boolean NOT NULL,
  inv_condition text,
  PRIMARY KEY (client_id, report_date, uk, channel)
);

CREATE TABLE IF NOT EXISTS public.smart_vdp_channel_pages_daily (
  client_id text NOT NULL,
  report_date date NOT NULL,
  channel text NOT NULL,
  all_views numeric NOT NULL,
  vdp_views numeric NOT NULL,
  PRIMARY KEY (client_id, report_date, channel)
);

CREATE TABLE IF NOT EXISTS public.smart_vdp_unit_first_seen (
  client_id text NOT NULL,
  uk text NOT NULL,
  first_d date NOT NULL,
  PRIMARY KEY (client_id, uk)
);

ALTER TABLE public.smart_vdp_inventory_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.smart_vdp_unit_views_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.smart_vdp_channel_pages_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.smart_vdp_unit_first_seen ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.refresh_vdp_analysis(p_client_id text, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '115s'
AS $function$
DECLARE
  v_name text;
  v_conner date;
  v_scrap boolean;
  v_inventory int;
  v_views int;
BEGIN
  SELECT h.customer_name INTO v_name
  FROM smart_hoot_config h
  WHERE h.is_active AND btrim(h.ga4_customer_id) = btrim(p_client_id)
  LIMIT 1;
  IF v_name IS NULL THEN
    RETURN jsonb_build_object('client_id', p_client_id, 'error', 'no active hoot config');
  END IF;

  SELECT min(c.update_date) INTO v_conner FROM smart_conner_inventory c WHERE c.customer_name = v_name;
  -- Dealers with no Hoot or Conner rows in the range use the scraped site inventory (keyed by GA4 client id).
  v_scrap := NOT EXISTS (
      SELECT 1 FROM smart_hoot_inventory_daily h
      WHERE h.customer_name = v_name AND h.pull_date BETWEEN p_from AND p_to)
    AND NOT EXISTS (
      SELECT 1 FROM smart_conner_inventory c
      WHERE c.customer_name = v_name AND c.update_date BETWEEN p_from AND p_to);

  DELETE FROM smart_vdp_inventory_daily WHERE client_id = p_client_id AND d BETWEEN p_from AND p_to;
  DELETE FROM smart_vdp_unit_views_daily WHERE client_id = p_client_id AND report_date BETWEEN p_from AND p_to;
  DELETE FROM smart_vdp_channel_pages_daily WHERE client_id = p_client_id AND report_date BETWEEN p_from AND p_to;

  INSERT INTO smart_vdp_inventory_daily (client_id, d, uk, vin, condition, year, make, model, url)
  SELECT DISTINCT ON (s.d, s.uk) p_client_id, s.d, s.uk, s.vin, s.condition, s.year, s.make, s.model, s.url
  FROM (
    SELECT h.pull_date AS d,
           upper(btrim(COALESCE(NULLIF(btrim(h.stock_number::text), ''), h.vin::text))) AS uk,
           upper(btrim(h.vin::text)) AS vin, h.condition::text AS condition, h.year::text AS year,
           h.make::text AS make, h.model::text AS model, h.url::text AS url
    FROM smart_hoot_inventory_daily h
    WHERE h.customer_name = v_name
      AND h.pull_date BETWEEN p_from AND p_to
      AND (v_conner IS NULL OR h.pull_date < v_conner)
    UNION ALL
    SELECT c.update_date,
           upper(btrim(COALESCE(NULLIF(btrim(c.stock_number::text), ''), c.vin::text))),
           upper(btrim(c.vin::text)), c.condition::text, c.year::text, c.make::text, c.model::text, c.url::text
    FROM smart_conner_inventory c
    WHERE v_conner IS NOT NULL
      AND c.customer_name = v_name
      AND c.update_date BETWEEN GREATEST(p_from, v_conner) AND p_to
    UNION ALL
    SELECT sc.pull_date,
           upper(btrim(COALESCE(NULLIF(btrim(sc.stock_number), ''), sc.vin))),
           upper(btrim(sc.vin)), sc.condition, sc.year, sc.make, sc.model, sc.url
    FROM smart_scrap_inventory_daily sc
    WHERE v_scrap
      AND sc.customer_id = p_client_id
      AND sc.pull_date BETWEEN p_from AND p_to
  ) s
  WHERE NULLIF(s.uk, '') IS NOT NULL
    AND length(s.uk) <= 100
  ORDER BY s.d, s.uk, (length(s.vin) = 17) DESC, (NULLIF(btrim(s.condition), '') IS NOT NULL) DESC;
  GET DIAGNOSTICS v_inventory = ROW_COUNT;

  INSERT INTO smart_vdp_unit_first_seen (client_id, uk, first_d)
  SELECT p_client_id, x.uk, min(x.d)
  FROM (
    SELECT upper(btrim(COALESCE(NULLIF(btrim(h.stock_number::text), ''), h.vin::text))) AS uk, h.pull_date AS d
    FROM smart_hoot_inventory_daily h
    WHERE h.customer_name = v_name AND h.pull_date <= p_to
    UNION ALL
    SELECT upper(btrim(COALESCE(NULLIF(btrim(c.stock_number::text), ''), c.vin::text))), c.update_date
    FROM smart_conner_inventory c
    WHERE c.customer_name = v_name AND c.update_date <= p_to
    UNION ALL
    SELECT upper(btrim(COALESCE(NULLIF(btrim(sc.stock_number), ''), sc.vin))), sc.pull_date
    FROM smart_scrap_inventory_daily sc
    WHERE v_scrap AND sc.customer_id = p_client_id AND sc.pull_date <= p_to
  ) x
  WHERE NULLIF(x.uk, '') IS NOT NULL
    AND length(x.uk) <= 100
  GROUP BY x.uk
  ON CONFLICT (client_id, uk) DO UPDATE SET first_d = LEAST(smart_vdp_unit_first_seen.first_d, EXCLUDED.first_d);

  CREATE TEMP TABLE IF NOT EXISTS tmp_vdp_page_channels (
    report_date date, page_path text, channel text, views numeric, is_vdp boolean
  ) ON COMMIT DROP;
  TRUNCATE tmp_vdp_page_channels;
  INSERT INTO tmp_vdp_page_channels
  SELECT p.report_date,
         COALESCE(btrim(p.page_path), ''),
         CASE WHEN n.ch IN ('Paid Social', 'Paid Search', 'Organic Search', 'Direct', 'Cross-network',
                            'Organic Social', 'Referral')
              THEN n.ch ELSE 'Other' END,
         COALESCE(p.views, 0),
         p.vdp_conditions IS TRUE
  FROM smart_ga4_page_data p
  CROSS JOIN LATERAL (SELECT public.event_tracking_channel_name(p.channel) AS ch) n
  WHERE p.client_id = p_client_id AND p.report_date BETWEEN p_from AND p_to;

  INSERT INTO smart_vdp_channel_pages_daily (client_id, report_date, channel, all_views, vdp_views)
  SELECT p_client_id, report_date, channel, SUM(views), COALESCE(SUM(views) FILTER (WHERE is_vdp), 0)
  FROM tmp_vdp_page_channels
  GROUP BY report_date, channel;

  INSERT INTO smart_vdp_unit_views_daily (client_id, report_date, uk, channel, views, in_stock, inv_condition)
  WITH weights AS (
    SELECT report_date, page_path, channel, SUM(views) AS cv
    FROM tmp_vdp_page_channels
    WHERE is_vdp
    GROUP BY 1, 2, 3
    HAVING SUM(views) > 0
  ),
  -- Scraped-feed dealers: Final rows without an inventory match are matched by the VIN at the end of the VDP URL.
  vin_map AS (
    SELECT DISTINCT ON (i.vin) i.vin, i.uk
    FROM smart_vdp_inventory_daily i
    WHERE v_scrap AND i.client_id = p_client_id AND i.d BETWEEN p_from AND p_to AND length(i.vin) = 17
    ORDER BY i.vin, i.d DESC
  ),
  fin AS (
    SELECT f.report_date,
           COALESCE(btrim(f.page_path), '') AS page_path,
           k.uk,
           max(f.inv_condition) AS inv_condition,
           SUM(COALESCE(f.views, 0)) AS views
    FROM smart_final_data f
    CROSS JOIN LATERAL (
      SELECT COALESCE(upper(btrim(COALESCE(NULLIF(btrim(f.inv_stock_number), ''), f.inv_vin))), '') AS raw_uk
    ) r
    LEFT JOIN vin_map vm
      ON r.raw_uk = '' AND vm.vin = upper(substring(f.page_path FROM '([A-HJ-NPR-Za-hj-npr-z0-9]{17})/?$'))
    CROSS JOIN LATERAL (
      SELECT CASE WHEN length(r.raw_uk) > 100 THEN '' WHEN r.raw_uk = '' THEN COALESCE(vm.uk, '') ELSE r.raw_uk END AS uk
    ) k
    WHERE f.client_id = p_client_id AND f.report_date BETWEEN p_from AND p_to
    GROUP BY 1, 2, 3
  ),
  alloc AS (
    SELECT fin.report_date, fin.uk, fin.inv_condition,
           COALESCE(w.channel, 'Other') AS channel,
           fin.views * COALESCE(
             w.cv::numeric / NULLIF(SUM(w.cv) OVER (PARTITION BY fin.report_date, fin.page_path, fin.uk), 0),
             1
           ) AS v
    FROM fin
    LEFT JOIN weights w ON w.report_date = fin.report_date AND w.page_path = fin.page_path
  )
  SELECT p_client_id, a.report_date, a.uk, a.channel, SUM(a.v),
         bool_or(i.uk IS NOT NULL), max(a.inv_condition)
  FROM alloc a
  LEFT JOIN smart_vdp_inventory_daily i
    ON i.client_id = p_client_id AND i.d = a.report_date AND i.uk = a.uk
  GROUP BY a.report_date, a.uk, a.channel;
  GET DIAGNOSTICS v_views = ROW_COUNT;

  RETURN jsonb_build_object('client_id', p_client_id, 'dealer', v_name, 'from', p_from, 'to', p_to,
                            'source', CASE WHEN v_scrap THEN 'scrap' ELSE 'feed' END,
                            'inventory_rows', v_inventory, 'view_rows', v_views);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_vdp_analysis(p_client_id text, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '25s'
AS $function$
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
    SELECT * FROM smart_vdp_inventory_daily
    WHERE client_id = p_client_id AND d BETWEEN p_from AND p_to
  ),
  views AS (
    SELECT * FROM smart_vdp_unit_views_daily
    WHERE client_id = p_client_id AND report_date BETWEEN p_from AND p_to
  ),
  unit_channels AS (
    SELECT uk, jsonb_object_agg(channel, round(v)) AS ch
    FROM (SELECT uk, channel, SUM(views) AS v FROM views WHERE in_stock GROUP BY 1, 2) x
    WHERE round(v) > 0
    GROUP BY uk
  ),
  fin_condition AS (
    SELECT uk, max(inv_condition) AS c FROM views WHERE uk <> '' GROUP BY uk
  ),
  units AS (
    SELECT s.uk,
           (array_agg(s.vin ORDER BY s.d DESC) FILTER (WHERE length(s.vin) = 17))[1] AS vin,
           (array_agg(s.condition ORDER BY s.d DESC) FILTER (WHERE NULLIF(btrim(s.condition), '') IS NOT NULL))[1] AS cond,
           (array_agg(s.year ORDER BY s.d DESC))[1] AS year,
           (array_agg(s.make ORDER BY s.d DESC))[1] AS make,
           (array_agg(s.model ORDER BY s.d DESC))[1] AS model,
           (array_agg(s.url ORDER BY s.d DESC))[1] AS url,
           count(*) AS days_listed,
           max(s.d) AS last_d
    FROM snap s
    GROUP BY s.uk
  )
  SELECT jsonb_build_object(
    'dealer', v_name,
    'connerFrom', v_conner,
    'snapshotDays', (SELECT count(DISTINCT d) FROM snap),
    'viewsInStock', COALESCE((SELECT round(SUM(views)) FROM views WHERE in_stock), 0),
    'viewsUnmatched', COALESCE((SELECT round(SUM(views)) FROM views WHERE NOT in_stock), 0),
    'channelPageViews', COALESCE((
      SELECT jsonb_object_agg(channel, jsonb_build_object('all', all_views, 'vdp', vdp_views))
      FROM (
        SELECT channel, SUM(all_views) AS all_views, SUM(vdp_views) AS vdp_views
        FROM smart_vdp_channel_pages_daily
        WHERE client_id = p_client_id AND report_date BETWEEN p_from AND p_to
        GROUP BY channel
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
        'daysInStock', (u.last_d - COALESCE(fl.first_d, u.last_d)) + 1,
        'channels', COALESCE(uc.ch, '{}'::jsonb)
      ) ORDER BY u.uk)
      FROM units u
      LEFT JOIN unit_channels uc USING (uk)
      LEFT JOIN fin_condition fc USING (uk)
      LEFT JOIN smart_vdp_unit_first_seen fl ON fl.client_id = p_client_id AND fl.uk = u.uk
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.refresh_vdp_analysis(text, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_vdp_analysis(text, date, date) TO service_role;
REVOKE ALL ON FUNCTION public.get_vdp_analysis(text, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_vdp_analysis(text, date, date) TO service_role;
