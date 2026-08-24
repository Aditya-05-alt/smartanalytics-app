-- Role-based dashboard access (normalized: roles, reports, emails, dealers).
-- Missing smart_user_roles row = legacy default Admin with full access.
-- Deploy in Supabase SQL Editor before Admin > Roles.

-- ── 1. Role catalog ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.smart_roles (
  role_key    text PRIMARY KEY,
  label       text NOT NULL,
  description text NULL
);

INSERT INTO public.smart_roles (role_key, label, description) VALUES
  ('admin', 'Admin', 'Full platform access — all reports and all active dealers'),
  ('user',  'User',  'Selective report and dealer access')
ON CONFLICT (role_key) DO UPDATE SET
  label = EXCLUDED.label,
  description = EXCLUDED.description;

-- ── 2. Report catalog ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.smart_reports (
  report_key  text PRIMARY KEY,
  label       text NOT NULL,
  href        text NOT NULL,
  sort_order  integer NOT NULL DEFAULT 0
);

INSERT INTO public.smart_reports (report_key, label, href, sort_order) VALUES
  ('overview',    'Overview',           '/dashboard',             1),
  ('inventory',   'Inventory report',   '/dashboard/inventory',   2),
  ('health',      'Portfolio Health',   '/dashboard/health',      3),
  ('attribution', 'Attribution',        '/dashboard/attribution', 4),
  ('local',       'Local Intel',        '/dashboard/local',       5)
ON CONFLICT (report_key) DO UPDATE SET
  label = EXCLUDED.label,
  href = EXCLUDED.href,
  sort_order = EXCLUDED.sort_order;

-- ── 3. User email + role (one row per auth user) ────────────────────────────

CREATE TABLE IF NOT EXISTS public.smart_user_roles (
  auth_user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email        text NOT NULL,
  role_key     text NOT NULL REFERENCES public.smart_roles(role_key),
  all_reports  boolean NOT NULL DEFAULT true,
  all_dealers  boolean NOT NULL DEFAULT true,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   text NULL
);

CREATE INDEX IF NOT EXISTS idx_smart_user_roles_role
  ON public.smart_user_roles (role_key);

CREATE INDEX IF NOT EXISTS idx_smart_user_roles_email
  ON public.smart_user_roles (lower(email));

COMMENT ON TABLE public.smart_user_roles IS
  'Maps Supabase Auth user (email) to role. Junction tables hold selective reports/dealers when role_key = user.';

-- ── 4. User → report (when not all_reports) ─────────────────────────────────

CREATE TABLE IF NOT EXISTS public.smart_user_reports (
  auth_user_id uuid NOT NULL REFERENCES public.smart_user_roles(auth_user_id) ON DELETE CASCADE,
  report_key   text NOT NULL REFERENCES public.smart_reports(report_key),
  PRIMARY KEY (auth_user_id, report_key)
);

CREATE INDEX IF NOT EXISTS idx_smart_user_reports_report
  ON public.smart_user_reports (report_key);

-- ── 5. User → dealer (when not all_dealers; dealer_id = smart_hoot_config.id) ─

CREATE TABLE IF NOT EXISTS public.smart_user_dealers (
  auth_user_id uuid NOT NULL REFERENCES public.smart_user_roles(auth_user_id) ON DELETE CASCADE,
  dealer_id    bigint NOT NULL,
  PRIMARY KEY (auth_user_id, dealer_id)
);

CREATE INDEX IF NOT EXISTS idx_smart_user_dealers_dealer
  ON public.smart_user_dealers (dealer_id);

-- ── 6. Migrate legacy flat table (if present) ───────────────────────────────

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'smart_user_access'
  ) THEN
    INSERT INTO public.smart_user_roles (
      auth_user_id, email, role_key, all_reports, all_dealers, updated_at, updated_by
    )
    SELECT
      a.auth_user_id,
      COALESCE(u.email, a.auth_user_id::text),
      a.role,
      a.all_reports,
      a.all_dealers,
      a.updated_at,
      a.updated_by
    FROM public.smart_user_access a
    LEFT JOIN auth.users u ON u.id = a.auth_user_id
    ON CONFLICT (auth_user_id) DO UPDATE SET
      email = EXCLUDED.email,
      role_key = EXCLUDED.role_key,
      all_reports = EXCLUDED.all_reports,
      all_dealers = EXCLUDED.all_dealers,
      updated_at = EXCLUDED.updated_at,
      updated_by = EXCLUDED.updated_by;

    INSERT INTO public.smart_user_reports (auth_user_id, report_key)
    SELECT a.auth_user_id, rk.report_key
    FROM public.smart_user_access a
    CROSS JOIN LATERAL unnest(a.report_keys) AS rk(report_key)
    WHERE a.role = 'user' AND a.all_reports IS NOT TRUE
    ON CONFLICT DO NOTHING;

    INSERT INTO public.smart_user_dealers (auth_user_id, dealer_id)
    SELECT a.auth_user_id, d.dealer_id
    FROM public.smart_user_access a
    CROSS JOIN LATERAL unnest(a.dealer_ids) AS d(dealer_id)
    WHERE a.role = 'user' AND a.all_dealers IS NOT TRUE
    ON CONFLICT DO NOTHING;

    DROP TABLE public.smart_user_access;
  END IF;
END;
$$;

-- ── 7. RLS (authenticated users read own row + junctions) ───────────────────

ALTER TABLE public.smart_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.smart_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.smart_user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.smart_user_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.smart_user_dealers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS smart_roles_select_all ON public.smart_roles;
CREATE POLICY smart_roles_select_all ON public.smart_roles FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS smart_reports_select_all ON public.smart_reports;
CREATE POLICY smart_reports_select_all ON public.smart_reports FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS smart_user_roles_select_own ON public.smart_user_roles;
CREATE POLICY smart_user_roles_select_own ON public.smart_user_roles
  FOR SELECT TO authenticated USING (auth_user_id = auth.uid());

DROP POLICY IF EXISTS smart_user_reports_select_own ON public.smart_user_reports;
CREATE POLICY smart_user_reports_select_own ON public.smart_user_reports
  FOR SELECT TO authenticated USING (auth_user_id = auth.uid());

DROP POLICY IF EXISTS smart_user_dealers_select_own ON public.smart_user_dealers;
CREATE POLICY smart_user_dealers_select_own ON public.smart_user_dealers
  FOR SELECT TO authenticated USING (auth_user_id = auth.uid());

GRANT SELECT ON public.smart_roles TO authenticated, service_role;
GRANT SELECT ON public.smart_reports TO authenticated, service_role;
GRANT SELECT ON public.smart_user_roles TO authenticated;
GRANT SELECT ON public.smart_user_reports TO authenticated;
GRANT SELECT ON public.smart_user_dealers TO authenticated;
GRANT ALL ON public.smart_roles TO service_role;
GRANT ALL ON public.smart_reports TO service_role;
GRANT ALL ON public.smart_user_roles TO service_role;
GRANT ALL ON public.smart_user_reports TO service_role;
GRANT ALL ON public.smart_user_dealers TO service_role;
