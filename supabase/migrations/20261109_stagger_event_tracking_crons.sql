-- Event Tracking crons (smart-ga4-events, smart-ga4-total-users) used to POST all 40 sync
-- groups at the same instant; concurrent requests share an edge worker and one CPU-limit
-- shutdown kills them all. Each run now posts ONE group, picked from the minute
-- (minutes 0-39 -> groups 1-40): form events 01:00-01:39 UTC, users 02:00-02:39 UTC.
-- Commands are rewritten in place (they hold the service key, which must not be in git).
-- Idempotent: jobs already staggered (no FOR loop) are left alone.

DO $do$
DECLARE
  j record;
  c text;
BEGIN
  FOR j IN SELECT * FROM (VALUES
    ('event-tracking-events-sync', '0-39 1 * * *'),
    ('event-tracking-users-sync',  '0-39 2 * * *')
  ) v(name, sched) LOOP
    SELECT command INTO c FROM cron.job WHERE jobname = j.name;
    CONTINUE WHEN c IS NULL OR position('FOR i IN 1..40 LOOP' in c) = 0;

    PERFORM cron.alter_job(
      (SELECT jobid FROM cron.job WHERE jobname = j.name),
      schedule := j.sched,
      command := replace(replace(c,
        'FOR i IN 1..40 LOOP',
        'i := extract(minute from now())::int + 1;' || chr(10) || '  IF i BETWEEN 1 AND 40 THEN'),
        'END LOOP;', 'END IF;')
    );
  END LOOP;
END $do$;
