-- Remove Bowling RV inventory from live + daily tables.
-- Wrong Hoot link caused another dealer's units to appear under Bowling RV.
--
-- Run in Supabase SQL Editor:
--   1. Run STEP 1 (preview) only — confirm row counts and names.
--   2. Run STEP 2 (delete) inside a transaction.
--   3. Run STEP 3 (verify) — both counts should be 0.
--
-- Does NOT delete smart_hoot_config — fix hoot_url / hoot_id there separately.

-- ── STEP 1: Preview ─────────────────────────────────────────────────────────

-- Config row(s) that match Bowling
SELECT id, customer_name, ga4_customer_id, hoot_id, hoot_url, is_active
FROM public.smart_hoot_config
WHERE TRIM(customer_name) ILIKE '%bowling%';

-- Names we will delete (config + explicit fallback)
WITH target_names AS (
  SELECT DISTINCT TRIM(customer_name) AS name
  FROM public.smart_hoot_config
  WHERE TRIM(customer_name) ILIKE '%bowling%'
  UNION
  SELECT 'Bowling RV'
)
SELECT
  'smart_hoot_inventory' AS table_name,
  TRIM(COALESCE(i.customer_name, '')) AS customer_name,
  TRIM(COALESCE(i.advertiser, '')) AS advertiser,
  COUNT(*) AS row_count
FROM public.smart_hoot_inventory i
WHERE EXISTS (
  SELECT 1 FROM target_names t
  WHERE TRIM(COALESCE(i.customer_name, '')) = t.name
     OR TRIM(COALESCE(i.advertiser, '')) = t.name
)
   OR TRIM(COALESCE(i.customer_name, '')) ILIKE '%bowling%'
   OR TRIM(COALESCE(i.advertiser, '')) ILIKE '%bowling%'
GROUP BY 1, 2, 3
ORDER BY row_count DESC;

WITH target_names AS (
  SELECT DISTINCT TRIM(customer_name) AS name
  FROM public.smart_hoot_config
  WHERE TRIM(customer_name) ILIKE '%bowling%'
  UNION
  SELECT 'Bowling RV'
)
SELECT
  'smart_hoot_inventory_daily' AS table_name,
  d.pull_date,
  TRIM(COALESCE(d.customer_name, '')) AS customer_name,
  TRIM(COALESCE(d.advertiser, '')) AS advertiser,
  COUNT(*) AS row_count
FROM public.smart_hoot_inventory_daily d
WHERE EXISTS (
  SELECT 1 FROM target_names t
  WHERE TRIM(COALESCE(d.customer_name, '')) = t.name
     OR TRIM(COALESCE(d.advertiser, '')) = t.name
)
   OR TRIM(COALESCE(d.customer_name, '')) ILIKE '%bowling%'
   OR TRIM(COALESCE(d.advertiser, '')) ILIKE '%bowling%'
GROUP BY 1, 2, 3, 4
ORDER BY d.pull_date DESC, row_count DESC;

-- ── STEP 2: Delete (uncomment BEGIN/COMMIT after preview looks correct) ─────

BEGIN;

WITH target_names AS (
  SELECT DISTINCT TRIM(customer_name) AS name
  FROM public.smart_hoot_config
  WHERE TRIM(customer_name) ILIKE '%bowling%'
  UNION
  SELECT 'Bowling RV'
)
DELETE FROM public.smart_hoot_inventory_daily d
WHERE EXISTS (
  SELECT 1 FROM target_names t
  WHERE TRIM(COALESCE(d.customer_name, '')) = t.name
     OR TRIM(COALESCE(d.advertiser, '')) = t.name
)
   OR TRIM(COALESCE(d.customer_name, '')) ILIKE '%bowling%'
   OR TRIM(COALESCE(d.advertiser, '')) ILIKE '%bowling%';

WITH target_names AS (
  SELECT DISTINCT TRIM(customer_name) AS name
  FROM public.smart_hoot_config
  WHERE TRIM(customer_name) ILIKE '%bowling%'
  UNION
  SELECT 'Bowling RV'
)
DELETE FROM public.smart_hoot_inventory i
WHERE EXISTS (
  SELECT 1 FROM target_names t
  WHERE TRIM(COALESCE(i.customer_name, '')) = t.name
     OR TRIM(COALESCE(i.advertiser, '')) = t.name
)
   OR TRIM(COALESCE(i.customer_name, '')) ILIKE '%bowling%'
   OR TRIM(COALESCE(i.advertiser, '')) ILIKE '%bowling%';

COMMIT;
-- ROLLBACK;  -- use instead of COMMIT if preview during delete looks wrong

-- ── STEP 3: Verify (should return 0 rows) ───────────────────────────────────

SELECT COUNT(*) AS live_rows_remaining
FROM public.smart_hoot_inventory
WHERE TRIM(COALESCE(customer_name, '')) ILIKE '%bowling%'
   OR TRIM(COALESCE(advertiser, '')) ILIKE '%bowling%';

SELECT COUNT(*) AS daily_rows_remaining
FROM public.smart_hoot_inventory_daily
WHERE TRIM(COALESCE(customer_name, '')) ILIKE '%bowling%'
   OR TRIM(COALESCE(advertiser, '')) ILIKE '%bowling%';
