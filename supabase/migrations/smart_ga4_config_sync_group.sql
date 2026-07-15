-- GA4 sync group assignment for smart_ga4_config (used by GA4 page sync cron).
-- New dealers are assigned via admin API (max 4 active dealers per group).
--
-- Deploy in Supabase SQL Editor if sync_group does not exist yet.

ALTER TABLE public.smart_ga4_config
  ADD COLUMN IF NOT EXISTS sync_group integer;

-- App assigns sync_group on dealer create; avoid DB default forcing group 1.
ALTER TABLE public.smart_ga4_config
  ALTER COLUMN sync_group DROP DEFAULT;

COMMENT ON COLUMN public.smart_ga4_config.sync_group IS
  'GA4 page sync batch group. Cron passes group_id to edge function. Max 4 active dealers per group (assigned on dealer create).';

CREATE INDEX IF NOT EXISTS idx_smart_ga4_config_sync_group
  ON public.smart_ga4_config (sync_group)
  WHERE is_active = true AND sync_group IS NOT NULL;
