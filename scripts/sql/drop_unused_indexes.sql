-- =====================================================================
-- Unused / duplicate index cleanup — project rllwmeqingvuohyctddg
-- Generated 2026-09-30 from pg_stat_user_indexes (stats never reset).
--
-- HOW TO RUN (Supabase SQL editor):
--   * DROP INDEX CONCURRENTLY cannot run inside a transaction block.
--     Run ONE statement at a time (select the line → Run).
--   * CONCURRENTLY = no table lock; GA4/Hoot syncs keep writing.
--   * Sections 1–2: safe (0 scans ever).
--   * Sections 3–4: commented out — review before uncommenting.
--
-- Estimated space freed:
--   Section 1  ≈  9.0 GB
--   Section 2  ≈  5.5 GB
--   Section 3  ≈ 10.0 GB (optional)
--   Section 4  ≈ 20.0 GB (optional, tables)
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0) PRE-CHECK — confirm scans are still 0 right before dropping
-- ---------------------------------------------------------------------
SELECT s.relname AS table_name,
       s.indexrelname AS index_name,
       s.idx_scan AS scans,
       pg_size_pretty(pg_relation_size(s.indexrelid)) AS size
FROM pg_stat_user_indexes s
WHERE s.schemaname = 'public'
  AND s.indexrelname IN (
    'idx_sfd_join_lookup', 'idx_final_data_client_date_path',
    'idx_sfbd_join_lookup', 'idx_sfbd_join', 'idx_sfbd_client_date_path',
    'idx_ga4_alltype_raw_profile_id', 'idx_ga4_alltype_raw_profile_date_id',
    'idx_sfbd_filters', 'idx_sfbd_page_path', 'idx_sfbd_inv_url',
    'idx_sfbd_client_date_make', 'idx_sfbd_client_date_year',
    'idx_sfbd_account_name', 'idx_sfbd_vdp_true', 'idx_sfbd_dealer_date_loc',
    'idx_sfd_inv_url', 'idx_sfd_vdp_true',
    'idx_ga4_daily_raw_profile_date_id', 'idx_ga4_daily_raw_profile_id',
    'idx_ga4_daily_raw_page_type', 'idx_ga4_daily_raw_date',
    'idx_ga4_daily_raw_dealer_id', 'idx_ga4_daily_raw_profile_id_only',
    'idx_smart_ga4_page_data_client_date_path_qs',
    'idx_smart_hoot_inventory_url_lower_trgm',
    'idx_smart_hoot_inventory_customer_url'
  )
ORDER BY pg_relation_size(s.indexrelid) DESC;


-- ---------------------------------------------------------------------
-- 1) EXACT DUPLICATES, 0 scans  (≈ 9.0 GB)
--    Same columns (client_id, report_date, page_path) as the unique
--    indexes uq_sfd_dealer_date_path / uq_sfbd_dealer_date_path (kept).
-- ---------------------------------------------------------------------
DROP INDEX CONCURRENTLY IF EXISTS public.idx_sfd_join_lookup;              -- smart_final_data       2194 MB
DROP INDEX CONCURRENTLY IF EXISTS public.idx_final_data_client_date_path;  -- smart_final_data       2194 MB
DROP INDEX CONCURRENTLY IF EXISTS public.idx_sfbd_join_lookup;             -- smart_final_bigq_data  1604 MB
DROP INDEX CONCURRENTLY IF EXISTS public.idx_sfbd_join;                    -- smart_final_bigq_data  1604 MB
DROP INDEX CONCURRENTLY IF EXISTS public.idx_sfbd_client_date_path;        -- smart_final_bigq_data  1604 MB


-- ---------------------------------------------------------------------
-- 2) NEVER SCANNED  (≈ 5.5 GB)
-- ---------------------------------------------------------------------
-- smart_ga4_bigq_alltype_raw (≈ 2.8 GB)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_ga4_alltype_raw_profile_id;       -- 1415 MB
DROP INDEX CONCURRENTLY IF EXISTS public.idx_ga4_alltype_raw_profile_date_id;  -- 1415 MB

-- smart_final_bigq_data (≈ 2.1 GB)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_sfbd_filters;           -- 1080 MB
DROP INDEX CONCURRENTLY IF EXISTS public.idx_sfbd_page_path;         --  192 MB
DROP INDEX CONCURRENTLY IF EXISTS public.idx_sfbd_inv_url;           --  182 MB
DROP INDEX CONCURRENTLY IF EXISTS public.idx_sfbd_client_date_make;  --  139 MB
DROP INDEX CONCURRENTLY IF EXISTS public.idx_sfbd_client_date_year;  --  133 MB
DROP INDEX CONCURRENTLY IF EXISTS public.idx_sfbd_account_name;      --  127 MB
DROP INDEX CONCURRENTLY IF EXISTS public.idx_sfbd_vdp_true;          --  122 MB
DROP INDEX CONCURRENTLY IF EXISTS public.idx_sfbd_dealer_date_loc;   --  108 MB

-- smart_final_data (≈ 0.4 GB)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_sfd_inv_url;   -- 275 MB
DROP INDEX CONCURRENTLY IF EXISTS public.idx_sfd_vdp_true;  -- 146 MB

-- smart_ga4_bigq_daily_raw_data (≈ 0.17 GB)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_ga4_daily_raw_profile_date_id;  -- 62 MB
DROP INDEX CONCURRENTLY IF EXISTS public.idx_ga4_daily_raw_profile_id;       -- 60 MB
DROP INDEX CONCURRENTLY IF EXISTS public.idx_ga4_daily_raw_page_type;        -- 13 MB
DROP INDEX CONCURRENTLY IF EXISTS public.idx_ga4_daily_raw_date;             -- 13 MB
DROP INDEX CONCURRENTLY IF EXISTS public.idx_ga4_daily_raw_dealer_id;        -- 13 MB
DROP INDEX CONCURRENTLY IF EXISTS public.idx_ga4_daily_raw_profile_id_only;  -- 13 MB

-- smart_ga4_page_data (0.1 GB) — QS (page_path_q_s) lookup, never used by planner
DROP INDEX CONCURRENTLY IF EXISTS public.idx_smart_ga4_page_data_client_date_path_qs;  -- 103 MB

-- smart_hoot_inventory (≈ 0.05 GB)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_smart_hoot_inventory_url_lower_trgm;  -- 34 MB
DROP INDEX CONCURRENTLY IF EXISTS public.idx_smart_hoot_inventory_customer_url;    -- 15 MB


-- ---------------------------------------------------------------------
-- 3) RARELY USED / REDUNDANT, LARGE  (≈ 10 GB) — REVIEW FIRST
--    Queries fall back to the index noted in each comment.
-- ---------------------------------------------------------------------
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_final_data_join;                         -- smart_final_data     2193 MB, same cols as unique uq_sfd_dealer_date_path
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_smart_final_data_client_date_type_fill;  -- smart_final_data     2365 MB, 56 scans (custom-type fill) → idx_sfd_dealer_date
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_final_data_filters;                      -- smart_final_data     1534 MB, 21 scans → idx_sfd_dealer_date
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_ga4_page_data_client_date_channel;       -- smart_ga4_page_data  1168 MB, 2 scans  → idx_smart_ga4_page_data_client_date
-- DROP INDEX CONCURRENTLY IF EXISTS public.smart_ga4_page_data_vdp;                     -- smart_ga4_page_data   691 MB, 336 scans, low selectivity
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_ga4_page_channel;                        -- smart_ga4_page_data   313 MB, 1 scan
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_smart_ga4_profile_date;                  -- smart_ga4_bigq_raw    490 MB → idx_ga4_raw_profile_date_id (same prefix)
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_smart_ga4_profile_id;                    -- smart_ga4_bigq_raw    373 MB → idx_ga4_raw_profile_date_id (same prefix)
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_smart_ga4_alltype_profile_date;          -- smart_ga4_bigq_alltype_raw 427 MB, 1 scan
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_smart_ga4_alltype_profile_id;            -- smart_ga4_bigq_alltype_raw 331 MB, 7 scans
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_smart_ga4_alltype_date;                  -- smart_ga4_bigq_alltype_raw 320 MB, 4 scans


-- ---------------------------------------------------------------------
-- 4) UNREFERENCED TABLES  (≈ 20 GB incl. indexes) — CONFIRM WITH OWNER
--    No app code, DB function, or cron job reads/writes these.
--    Optional: export first (pg_dump -t <table>) before dropping.
-- ---------------------------------------------------------------------
-- DROP TABLE IF EXISTS public.smart_ga4_bigq_alltype_raw;   -- 12 GB + 4.9 GB idx, frozen since 2026-09-10
-- DROP TABLE IF EXISTS public.smart_ga4_page_data_backup;   -- 2.1 GB + 232 MB idx, one-off backup
-- DROP TABLE IF EXISTS public.ga4_raw_metrics;              -- 126 MB + 81 MB idx, no references
-- smart_master_db (215 MB + 102 MB): still referenced by build_smart_master_db,
-- sync_master_db_for_client, populate_smart_master_db, get_daily_pipeline_status —
-- drop those functions first if retiring it.
-- DROP TABLE IF EXISTS public.smart_master_db;


-- ---------------------------------------------------------------------
-- 5) POST-CHECK — database size after cleanup
-- ---------------------------------------------------------------------
SELECT pg_size_pretty(pg_database_size(current_database())) AS db_size,
       pg_size_pretty(sum(pg_relation_size(indexrelid))) AS public_index_size
FROM pg_stat_user_indexes
WHERE schemaname = 'public';
