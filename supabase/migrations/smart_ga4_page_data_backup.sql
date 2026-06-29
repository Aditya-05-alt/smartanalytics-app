-- smart_ga4_page_data → smart_ga4_page_data_backup (12M+ rows — use BATCHES)
-- Run in Supabase → SQL Editor

-- ── Step 1: Create the backup table (run once) ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.smart_ga4_page_data_backup (
  id integer NOT NULL,
  client_id text NOT NULL,
  ga4_property_id text NOT NULL,
  account_name text NULL,
  report_date date NOT NULL,
  page_location text NULL,
  page_path text NOT NULL,
  page_title text NULL,
  session_campaign text NULL,
  channel text NULL,
  source text NULL,
  medium text NULL,
  source_medium text NULL,
  views integer NULL DEFAULT 0,
  total_users integer NULL DEFAULT 0,
  sessions integer NULL DEFAULT 0,
  new_users integer NULL DEFAULT 0,
  created_at timestamp with time zone NULL DEFAULT now(),
  vdp_conditions boolean NULL DEFAULT false,
  vdp_vehicle_condition text NULL,
  year integer NULL,
  ga4_page_type text NULL,
  cms text NULL,
  CONSTRAINT smart_ga4_page_data_backup_pkey PRIMARY KEY (id)
);

-- ── Step 2a: See how much data per month (pick batch size) ───────────────────
SELECT
  date_trunc('month', report_date)::date AS month_start,
  count(*) AS rows
FROM public.smart_ga4_page_data
GROUP BY 1
ORDER BY 1;

-- ── Step 2b: Copy in MONTHLY batches (run ONE block at a time) ───────────────
-- Each INSERT is a separate query → avoids one giant transaction timeout.
-- Resume safely: already-copied ids are skipped.

-- January 2024 example (change dates for each month, run repeatedly):
/*
INSERT INTO public.smart_ga4_page_data_backup
SELECT *
FROM public.smart_ga4_page_data
WHERE report_date >= '2024-01-01'
  AND report_date < '2024-02-01'
ON CONFLICT (id) DO NOTHING;
*/

-- ── Step 2c: Auto-generate monthly INSERT statements (copy output & run each) ─
SELECT format(
  $sql$
INSERT INTO public.smart_ga4_page_data_backup
SELECT *
FROM public.smart_ga4_page_data
WHERE report_date >= %L
  AND report_date < %L
ON CONFLICT (id) DO NOTHING;
$sql$,
  month_start,
  (month_start + interval '1 month')::date
) AS run_one_by_one
FROM (
  SELECT date_trunc('month', report_date)::date AS month_start
  FROM public.smart_ga4_page_data
  GROUP BY 1
  ORDER BY 1
) m;

-- ── Step 2d: If ONE month still times out — split by client_id ───────────────
/*
INSERT INTO public.smart_ga4_page_data_backup
SELECT *
FROM public.smart_ga4_page_data
WHERE report_date >= '2024-06-01'
  AND report_date < '2024-07-01'
  AND client_id = 'YOUR_CLIENT_ID'
ON CONFLICT (id) DO NOTHING;
*/

-- ── Step 2e: Last resort — batch by id range (~500k rows per run) ────────────
/*
INSERT INTO public.smart_ga4_page_data_backup
SELECT *
FROM public.smart_ga4_page_data
WHERE id >= 1 AND id < 500001
ON CONFLICT (id) DO NOTHING;
-- then id >= 500001 AND id < 1000001, etc.
*/

-- ── Step 3: Progress check ───────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM public.smart_ga4_page_data) AS live_rows,
  (SELECT count(*) FROM public.smart_ga4_page_data_backup) AS backup_rows,
  (SELECT count(*) FROM public.smart_ga4_page_data)
    - (SELECT count(*) FROM public.smart_ga4_page_data_backup) AS rows_remaining;
