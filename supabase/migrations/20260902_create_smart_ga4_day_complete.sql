-- Step 1 GA4 sync completion markers (used by smart-ga4-cron-sync).
-- Days older than the settling window may be skipped; recent days always re-fetch.

CREATE TABLE IF NOT EXISTS public.smart_ga4_day_complete (
  client_id text NOT NULL,
  report_date date NOT NULL,
  row_count integer,
  completed_at timestamptz DEFAULT now(),
  PRIMARY KEY (client_id, report_date)
);

CREATE INDEX IF NOT EXISTS smart_ga4_day_complete_date_idx
  ON public.smart_ga4_day_complete (report_date);

COMMENT ON TABLE public.smart_ga4_day_complete IS
  'Step 1 GA4 sync completion markers. Days older than settling window may be skipped; recent days always re-fetch.';
