-- VDP Analysis daily sync (edge: vdp-analysis-daily-sync).
-- Refreshes smart_vdp_* tables via refresh_vdp_analysis for active dealers.
-- Daily window = last 5 settled days only (UTC today − 2, then 5 days back).
-- Wider ranges must be requested explicitly (date_from/date_to or fill_month) and are
-- still processed in ≤5-day chunks inside the edge function.
--
-- Cron: supabase/cron/vdp-analysis-daily-sync.schedule.sql (06:40 UTC daily).
--
-- Fix: vdp_summary_cache_clear used DELETE without WHERE, which fails under safeupdate
-- when refresh_vdp_analysis deletes inventory / unit_views rows.

CREATE OR REPLACE FUNCTION public.vdp_summary_cache_clear()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM public.smart_vdp_summary_cache WHERE true;
  RETURN NULL;
END;
$function$;
