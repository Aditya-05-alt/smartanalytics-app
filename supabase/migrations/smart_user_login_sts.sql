-- Frontend dealer login / session activity (not admin panel).
-- Deploy in Supabase SQL editor. No in-app admin UI — view rows in Supabase Table Editor.
--
-- RLS: authenticated users may INSERT their own rows only; no SELECT from the app.

CREATE TABLE IF NOT EXISTS public.smart_user_login_sts (
  id                bigserial PRIMARY KEY,
  auth_user_id      uuid NOT NULL,
  user_email        text,
  user_name         text,
  event_type        text NOT NULL,
  event_action      text,
  page_path         text,
  page_url          text,
  ip_address        text,
  user_agent        text,
  device_type       text,
  browser           text,
  os                text,
  screen_resolution text,
  viewport          text,
  timezone          text,
  locale            text,
  referrer          text,
  session_id        text,
  metadata          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT smart_user_login_sts_event_type_check
    CHECK (event_type IN (
      'login',
      'logout',
      'page_view',
      'session_start',
      'session_heartbeat',
      'action'
    ))
);

CREATE INDEX IF NOT EXISTS idx_smart_user_login_sts_user_time
  ON public.smart_user_login_sts (auth_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_smart_user_login_sts_event_time
  ON public.smart_user_login_sts (event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_smart_user_login_sts_session
  ON public.smart_user_login_sts (session_id)
  WHERE session_id IS NOT NULL;

COMMENT ON TABLE public.smart_user_login_sts IS
  'Frontend dealer session telemetry: login, logout, page views, device and IP. Not used for /dashboard/admin.';

ALTER TABLE public.smart_user_login_sts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS smart_user_login_sts_insert_own ON public.smart_user_login_sts;

CREATE POLICY smart_user_login_sts_insert_own
  ON public.smart_user_login_sts
  FOR INSERT
  TO authenticated
  WITH CHECK (auth_user_id = auth.uid());

-- App users cannot read telemetry rows (Supabase dashboard / service_role only).
REVOKE ALL ON public.smart_user_login_sts FROM anon;
GRANT INSERT ON public.smart_user_login_sts TO authenticated;
GRANT ALL ON public.smart_user_login_sts TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.smart_user_login_sts_id_seq TO authenticated;
