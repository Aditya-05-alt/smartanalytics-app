-- VDP Change (/dashboard/vdp-change): this period vs the previous month (or the same month last
-- year), split per channel into what traffic explains and the real change.
--   smart_events_users          GA4 users / sessions / page views per exact period (smart-ga4-total-users)
--   smart_event_tracking_vdp_daily  Final VDP views per dealer/day/channel
--   smart_vdp_inventory_daily   in-stock units per day (feed snapshots)
--   smart_vdp_change_rates      standard VDP rate per channel group, the same for every dealer

ALTER TABLE public.smart_events_users ADD COLUMN IF NOT EXISTS sessions integer;
ALTER TABLE public.smart_events_users ADD COLUMN IF NOT EXISTS page_views integer;

CREATE OR REPLACE FUNCTION public.vdp_change_group(p_channel text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE replace(replace(lower(btrim(COALESCE(p_channel, ''))), '_', ' '), '-', ' ')
    WHEN 'paid search' THEN 'Paid Search'
    WHEN 'cross network' THEN 'PMax'
    WHEN 'paid social' THEN 'Paid Social'
    WHEN 'organic search' THEN 'Organic Search'
    WHEN 'direct' THEN 'Direct'
    WHEN 'organic social' THEN 'Organic Social'
    ELSE 'Other'
  END;
$$;

CREATE TABLE IF NOT EXISTS public.smart_vdp_change_rates (
  grp text PRIMARY KEY,
  rate numeric NOT NULL,
  basis text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.smart_vdp_change_rates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.smart_vdp_change_rates FROM anon, authenticated;

-- One row per dealer, period ('cur' / 'prev') and channel group. grp '(all)' carries whole-site
-- users / sessions / page views; grp '(stock)' carries average in-stock units per day.
CREATE OR REPLACE FUNCTION public.get_vdp_change(
  p_from date,
  p_to date,
  p_prev_from date,
  p_prev_to date,
  p_client_ids text[]
)
RETURNS TABLE (
  client_id text,
  period text,
  grp text,
  users bigint,
  sessions bigint,
  page_views bigint,
  vdp bigint,
  stock numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '55s'
AS $$
  WITH per AS (
    SELECT 'cur'::text AS period, p_from AS f, p_to AS t
    UNION ALL SELECT 'prev', p_prev_from, p_prev_to
  ),
  v AS (
    SELECT d.client_id, per.period, public.vdp_change_group(d.channel) AS grp, SUM(d.final_views)::bigint AS vdp
    FROM per
    JOIN public.smart_event_tracking_vdp_daily d ON d.report_date BETWEEN per.f AND per.t
    WHERE d.client_id = ANY (p_client_ids)
    GROUP BY 1, 2, 3
  ),
  u AS (
    SELECT e.client_id, per.period,
           CASE WHEN e.channel = '(all)' THEN '(all)' ELSE public.vdp_change_group(e.channel) END AS grp,
           SUM(e.total_users)::bigint AS users,
           SUM(e.sessions)::bigint AS sessions,
           SUM(e.page_views)::bigint AS page_views
    FROM per
    JOIN public.smart_events_users e ON e.period_from = per.f AND e.period_to = per.t
    WHERE e.client_id = ANY (p_client_ids)
    GROUP BY 1, 2, 3
  ),
  s AS (
    SELECT i.client_id, per.period, '(stock)'::text AS grp,
           COUNT(*)::numeric / NULLIF(COUNT(DISTINCT i.d), 0) AS stock
    FROM per
    JOIN public.smart_vdp_inventory_daily i ON i.d BETWEEN per.f AND per.t
    WHERE i.client_id = ANY (p_client_ids)
    GROUP BY 1, 2
  )
  SELECT COALESCE(u.client_id, v.client_id), COALESCE(u.period, v.period), COALESCE(u.grp, v.grp),
         u.users, u.sessions, u.page_views, v.vdp, NULL::numeric
  FROM u
  FULL JOIN v ON v.client_id = u.client_id AND v.period = u.period AND v.grp = u.grp
  UNION ALL
  SELECT s.client_id, s.period, s.grp, NULL, NULL, NULL, NULL, s.stock FROM s;
$$;

REVOKE ALL ON FUNCTION public.get_vdp_change(date, date, date, date, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_vdp_change(date, date, date, date, text[]) TO service_role;

-- Explicit report (EXPLICIT_REPORT_KEYS in permissions.js): aditya@brandmirchi.com only for now.
INSERT INTO public.smart_reports (report_key, label, href, sort_order)
VALUES ('vdp-change', 'VDP Change', '/dashboard/vdp-change', 9)
ON CONFLICT (report_key) DO UPDATE SET label = EXCLUDED.label, href = EXCLUDED.href, sort_order = EXCLUDED.sort_order;

INSERT INTO public.smart_user_reports (auth_user_id, report_key)
SELECT ur.auth_user_id, 'vdp-change'
FROM public.smart_user_roles ur
WHERE lower(ur.email) = 'aditya@brandmirchi.com'
ON CONFLICT DO NOTHING;
