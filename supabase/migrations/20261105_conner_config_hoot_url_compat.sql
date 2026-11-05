-- TEMPORARY: read-only mirror of wheeler_url so the not-yet-redeployed app (old code selecting
-- smart_conner_config.hoot_url) keeps working. Drop it once the app with the wheeler_url code is live:
--   ALTER TABLE public.smart_conner_config DROP COLUMN hoot_url;
ALTER TABLE public.smart_conner_config
  ADD COLUMN IF NOT EXISTS hoot_url text GENERATED ALWAYS AS (wheeler_url) STORED;
