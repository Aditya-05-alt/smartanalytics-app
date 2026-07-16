-- GA4 sync group assignment for smart_ga4_config (used by GA4 page sync cron).
-- Rule: max 4 active dealers per group. Prefer highest existing group if < 4;
-- otherwise open max + 1. Runs on INSERT when sync_group is NULL (and backfills).
--
-- Deploy in Supabase SQL Editor.

ALTER TABLE public.smart_ga4_config
  ADD COLUMN IF NOT EXISTS sync_group integer;

-- App / trigger assign sync_group; avoid DB default forcing group 1.
ALTER TABLE public.smart_ga4_config
  ALTER COLUMN sync_group DROP DEFAULT;

COMMENT ON COLUMN public.smart_ga4_config.sync_group IS
  'GA4 page sync batch group. Cron passes group_id to edge function. Max 4 active dealers per group (assigned on insert via trigger or admin API).';

CREATE INDEX IF NOT EXISTS idx_smart_ga4_config_sync_group
  ON public.smart_ga4_config (sync_group)
  WHERE is_active = true AND sync_group IS NOT NULL;

-- Next sync_group for a new active dealer (same rules as src/lib/dealers/syncGroup.js).
CREATE OR REPLACE FUNCTION public.resolve_ga4_sync_group()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  max_group integer := 0;
  dealers_in_max integer := 0;
BEGIN
  SELECT COALESCE(MAX(sync_group), 0)
  INTO max_group
  FROM public.smart_ga4_config
  WHERE is_active = true
    AND sync_group IS NOT NULL;

  IF max_group < 1 THEN
    RETURN 1;
  END IF;

  SELECT COUNT(*)::integer
  INTO dealers_in_max
  FROM public.smart_ga4_config
  WHERE is_active = true
    AND sync_group = max_group;

  IF dealers_in_max < 4 THEN
    RETURN max_group;
  END IF;

  RETURN max_group + 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.smart_ga4_config_assign_sync_group()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only auto-fill when caller left sync_group unset.
  IF NEW.sync_group IS NULL AND COALESCE(NEW.is_active, true) THEN
    NEW.sync_group := public.resolve_ga4_sync_group();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_smart_ga4_config_assign_sync_group ON public.smart_ga4_config;

CREATE TRIGGER trg_smart_ga4_config_assign_sync_group
  BEFORE INSERT ON public.smart_ga4_config
  FOR EACH ROW
  EXECUTE FUNCTION public.smart_ga4_config_assign_sync_group();

-- Backfill existing active rows that never got a group (e.g. Hobbytime Boliver).
DO $$
DECLARE
  r record;
  next_group integer;
BEGIN
  FOR r IN
    SELECT id
    FROM public.smart_ga4_config
    WHERE sync_group IS NULL
      AND COALESCE(is_active, true)
    ORDER BY created_at NULLS LAST, id
  LOOP
    next_group := public.resolve_ga4_sync_group();
    UPDATE public.smart_ga4_config
    SET sync_group = next_group
    WHERE id = r.id;
  END LOOP;
END;
$$;
