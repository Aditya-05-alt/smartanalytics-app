-- smart-ga4-sync-cron used to POST all 40 sync groups to smart-ga4-cron-sync at the same
-- instant. The edge runtime runs those concurrent requests in a shared worker; when it hits
-- the CPU limit ("CPU Time exceeded") every in-flight group dies, usually right after its
-- first dealer, so only ~40 of ~94 dealers got GA4 page data per day.
--
-- Now each run posts ONE group, picked from the minute: minutes 0-39 -> groups 1-40,
-- four passes a night (21:00, 22:00, 23:00, 00:00 UTC).
-- The command is rewritten in place (it holds the service key, which must not be in git).
-- Idempotent: a job already staggered (no FOR loop) is left alone.

DO $do$
DECLARE
  c text;
BEGIN
  SELECT command INTO c FROM cron.job WHERE jobname = 'smart-ga4-sync-cron';
  IF c IS NULL OR position('FOR i IN 1..40 LOOP' in c) = 0 THEN
    RETURN;
  END IF;

  PERFORM cron.alter_job(
    (SELECT jobid FROM cron.job WHERE jobname = 'smart-ga4-sync-cron'),
    schedule := '0-39 21,22,23,0 * * *',
    command := replace(replace(c,
      'FOR i IN 1..40 LOOP',
      'i := extract(minute from now())::int + 1;' || chr(10) || '    IF i BETWEEN 1 AND 40 THEN'),
      'END LOOP;', 'END IF;')
  );
END $do$;
