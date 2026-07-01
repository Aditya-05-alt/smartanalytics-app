-- Bulk upsert scrap inventory + day-complete marker (external worker).
-- Deploy in Supabase SQL editor.

DROP FUNCTION IF EXISTS public.upsert_scrap_inventory_batch(jsonb, text, date, uuid);

CREATE OR REPLACE FUNCTION public.upsert_scrap_inventory_batch(
  p_rows          jsonb,
  p_client_id     text,
  p_report_date   date DEFAULT CURRENT_DATE,
  p_scrape_run_id uuid DEFAULT gen_random_uuid()
)
RETURNS TABLE (
  upserted_count bigint,
  scrape_run_id  uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id uuid := COALESCE(p_scrape_run_id, gen_random_uuid());
  v_count  bigint := 0;
  v_name   text;
BEGIN
  SELECT h.customer_name INTO v_name
  FROM public.smart_hoot_config h
  WHERE trim(h.ga4_customer_id::text) = trim(p_client_id)
  ORDER BY h.id DESC
  LIMIT 1;

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'No smart_hoot_config row for ga4_customer_id %', p_client_id;
  END IF;

  INSERT INTO public.smart_scrap_data (
    customer_name,
    ga4_customer_id,
    url,
    sk,
    vin,
    make,
    model,
    year,
    trim,
    price,
    msrp,
    condition,
    type_,
    stock_number,
    location,
    first_seen,
    last_seen,
    source_list_url,
    scraped_at,
    scrape_run_id,
    updated_at
  )
  SELECT
    v_name,
    trim(p_client_id),
    trim(r->>'url'),
    NULLIF(trim(r->>'sk'), ''),
    NULLIF(trim(r->>'vin'), ''),
    NULLIF(trim(r->>'make'), ''),
    NULLIF(trim(r->>'model'), ''),
    NULLIF((r->>'year'), '')::integer,
    NULLIF(trim(r->>'trim'), ''),
    NULLIF((r->>'price'), '')::numeric,
    NULLIF((r->>'msrp'), '')::numeric,
    NULLIF(trim(r->>'condition'), ''),
    NULLIF(trim(r->>'type_'), ''),
    NULLIF(trim(r->>'stock_number'), ''),
    NULLIF(trim(r->>'location'), ''),
    COALESCE((r->>'first_seen')::timestamptz, now()),
    COALESCE((r->>'last_seen')::timestamptz, now()),
    NULLIF(trim(r->>'source_list_url'), ''),
    now(),
    v_run_id,
    now()
  FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) AS r
  WHERE trim(COALESCE(r->>'url', '')) <> ''
  ON CONFLICT (customer_name, url_norm)
  DO UPDATE SET
    ga4_customer_id = EXCLUDED.ga4_customer_id,
    sk              = EXCLUDED.sk,
    vin             = EXCLUDED.vin,
    make            = EXCLUDED.make,
    model           = EXCLUDED.model,
    year            = EXCLUDED.year,
    trim            = EXCLUDED.trim,
    price           = EXCLUDED.price,
    msrp            = EXCLUDED.msrp,
    condition       = EXCLUDED.condition,
    type_           = EXCLUDED.type_,
    stock_number    = EXCLUDED.stock_number,
    location        = EXCLUDED.location,
    last_seen       = EXCLUDED.last_seen,
    source_list_url = COALESCE(EXCLUDED.source_list_url, smart_scrap_data.source_list_url),
    scraped_at      = now(),
    scrape_run_id   = v_run_id,
    updated_at      = now();

  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO public.smart_scrap_day_complete (
    ga4_customer_id,
    report_date,
    row_count,
    scrape_run_id,
    completed_at
  )
  VALUES (
    trim(p_client_id),
    COALESCE(p_report_date, CURRENT_DATE),
    v_count::integer,
    v_run_id,
    now()
  )
  ON CONFLICT (ga4_customer_id, report_date)
  DO UPDATE SET
    row_count     = EXCLUDED.row_count,
    scrape_run_id = EXCLUDED.scrape_run_id,
    completed_at  = now();

  RETURN QUERY SELECT v_count, v_run_id;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_scrap_inventory_batch(jsonb, text, date, uuid)
  FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.upsert_scrap_inventory_batch(jsonb, text, date, uuid)
  TO service_role;
