-- VDP Change daily sync support:
--   refresh_vdp_change_stock(from, to)  fills smart_vdp_inventory_daily for all active dealers
--   (stock metric only — lighter than refresh_vdp_analysis).
-- Edge function vdp-change-daily-sync inserts November (or current month) + last 5 settled days
-- for VDP views, stock, and GA4 traffic periods used by get_vdp_change.

CREATE OR REPLACE FUNCTION public.refresh_vdp_change_stock(
  p_from date,
  p_to date,
  p_client_ids text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '110s'
AS $$
DECLARE
  v_deleted integer := 0;
  v_inserted integer := 0;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RAISE EXCEPTION 'invalid date range: % → %', p_from, p_to;
  END IF;

  DELETE FROM public.smart_vdp_inventory_daily i
  WHERE i.d BETWEEN p_from AND p_to
    AND (
      p_client_ids IS NULL
      OR i.client_id = ANY (p_client_ids)
    );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  WITH dealers AS (
    SELECT DISTINCT ON (btrim(h.ga4_customer_id))
      btrim(h.ga4_customer_id) AS client_id,
      h.customer_name AS dealer_name
    FROM public.smart_hoot_config h
    WHERE h.is_active
      AND NULLIF(btrim(h.ga4_customer_id), '') IS NOT NULL
      AND NULLIF(btrim(h.customer_name), '') IS NOT NULL
      AND (p_client_ids IS NULL OR btrim(h.ga4_customer_id) = ANY (p_client_ids))
    ORDER BY btrim(h.ga4_customer_id), h.is_active DESC NULLS LAST, h.id DESC
  ),
  conner_start AS (
    SELECT d.client_id, min(c.update_date) AS first_conner
    FROM dealers d
    JOIN public.smart_conner_inventory c ON c.customer_name = d.dealer_name
    GROUP BY d.client_id
  ),
  feed_flags AS (
    SELECT
      d.client_id,
      d.dealer_name,
      cs.first_conner,
      EXISTS (
        SELECT 1
        FROM public.smart_hoot_inventory_daily h
        WHERE h.customer_name = d.dealer_name
          AND h.pull_date BETWEEN p_from AND p_to
      ) AS has_hoot,
      EXISTS (
        SELECT 1
        FROM public.smart_conner_inventory c
        WHERE c.customer_name = d.dealer_name
          AND c.update_date BETWEEN p_from AND p_to
      ) AS has_conner
    FROM dealers d
    LEFT JOIN conner_start cs ON cs.client_id = d.client_id
  ),
  src AS (
    SELECT
      f.client_id,
      h.pull_date AS d,
      upper(btrim(COALESCE(NULLIF(btrim(h.stock_number::text), ''), h.vin::text))) AS uk,
      upper(btrim(h.vin::text)) AS vin,
      h.condition::text AS condition,
      h.year::text AS year,
      h.make::text AS make,
      h.model::text AS model,
      h.url::text AS url
    FROM feed_flags f
    JOIN public.smart_hoot_inventory_daily h
      ON h.customer_name = f.dealer_name
     AND h.pull_date BETWEEN p_from AND p_to
     AND (f.first_conner IS NULL OR h.pull_date < f.first_conner)
    UNION ALL
    SELECT
      f.client_id,
      c.update_date,
      upper(btrim(COALESCE(NULLIF(btrim(c.stock_number::text), ''), c.vin::text))),
      upper(btrim(c.vin::text)),
      c.condition::text,
      c.year::text,
      c.make::text,
      c.model::text,
      c.url::text
    FROM feed_flags f
    JOIN public.smart_conner_inventory c
      ON c.customer_name = f.dealer_name
     AND f.first_conner IS NOT NULL
     AND c.update_date BETWEEN GREATEST(p_from, f.first_conner) AND p_to
    UNION ALL
    SELECT
      f.client_id,
      sc.pull_date,
      upper(btrim(COALESCE(NULLIF(btrim(sc.stock_number), ''), sc.vin))),
      upper(btrim(sc.vin)),
      sc.condition,
      sc.year,
      sc.make,
      sc.model,
      sc.url
    FROM feed_flags f
    JOIN public.smart_scrap_inventory_daily sc
      ON sc.customer_id = f.client_id
     AND sc.pull_date BETWEEN p_from AND p_to
    WHERE NOT f.has_hoot AND NOT f.has_conner
  )
  INSERT INTO public.smart_vdp_inventory_daily (client_id, d, uk, vin, condition, year, make, model, url)
  SELECT DISTINCT ON (s.client_id, s.d, s.uk)
    s.client_id, s.d, s.uk, s.vin, s.condition, s.year, s.make, s.model, s.url
  FROM src s
  WHERE NULLIF(s.uk, '') IS NOT NULL
    AND length(s.uk) <= 100
  ORDER BY s.client_id, s.d, s.uk,
           (length(COALESCE(s.vin, '')) = 17) DESC,
           (NULLIF(btrim(COALESCE(s.condition, '')), '') IS NOT NULL) DESC;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RETURN jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'deleted', v_deleted,
    'inserted', v_inserted
  );
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_vdp_change_stock(date, date, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_vdp_change_stock(date, date, text[]) TO service_role;
