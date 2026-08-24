-- Session/user totals from smart_ga4_data when that table exists (optional).
-- Returns no rows if smart_ga4_data is not deployed — overview still loads page views.
-- SECURITY DEFINER so reads work if RLS is enabled on smart_ga4_data.

CREATE OR REPLACE FUNCTION public.get_ga4_user_totals(
  p_client_id text,
  p_from date,
  p_to date
)
RETURNS TABLE(
  report_date date,
  total_users bigint,
  new_users bigint,
  sessions bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'smart_ga4_data'
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    d.report_date,
    SUM(d.total_users)::bigint AS total_users,
    SUM(d.new_users)::bigint   AS new_users,
    SUM(d.sessions)::bigint    AS sessions
  FROM smart_ga4_data d
  WHERE d.client_id = p_client_id
    AND d.report_date BETWEEN p_from AND p_to
  GROUP BY d.report_date
  ORDER BY d.report_date;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_ga4_user_totals(text, date, date)
  TO anon, authenticated, service_role;
