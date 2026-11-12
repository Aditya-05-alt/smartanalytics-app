-- Wheeler Pump: monthly reports (one calendar month, e.g. Polaris Sell-In / Sell-Out run for 9/1–9/30).
-- Same shape and access rules as the quarterly tables; save_report_rows gains p_monthly / p_monthly_dealers.

CREATE TABLE IF NOT EXISTS public.wheeler_pump_monthly (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.wheeler_pump_clients(id) ON DELETE CASCADE,
  month text NOT NULL CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  location text NOT NULL,
  brand text NOT NULL,
  line text NOT NULL,
  local_sales integer NOT NULL DEFAULT 0,
  pumped_in integer NOT NULL DEFAULT 0,
  pumped_out integer NOT NULL DEFAULT 0,
  source text,
  upload_id uuid REFERENCES public.wheeler_pump_uploads(id) ON DELETE SET NULL,
  UNIQUE (client_id, month, location, brand, line)
);
CREATE INDEX IF NOT EXISTS wheeler_pump_monthly_client_id_idx ON public.wheeler_pump_monthly (client_id);

CREATE TABLE IF NOT EXISTS public.wheeler_pump_monthly_dealers (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.wheeler_pump_clients(id) ON DELETE CASCADE,
  month text NOT NULL CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  location text NOT NULL,
  brand text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('In', 'Out')),
  name text NOT NULL,
  units integer NOT NULL DEFAULT 0,
  upload_id uuid REFERENCES public.wheeler_pump_uploads(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS wheeler_pump_monthly_dealers_key_idx
  ON public.wheeler_pump_monthly_dealers (client_id, month, location, brand);

ALTER TABLE public.wheeler_pump_monthly ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wheeler_pump_monthly_dealers ENABLE ROW LEVEL SECURITY;
CREATE POLICY wheeler_pump_monthly_read ON public.wheeler_pump_monthly
  FOR SELECT USING (public.wheeler_pump_can_view_client(client_id));
CREATE POLICY wheeler_pump_monthly_write ON public.wheeler_pump_monthly
  FOR ALL USING (public.is_wheeler()) WITH CHECK (public.is_wheeler());
CREATE POLICY wheeler_pump_monthly_dealers_read ON public.wheeler_pump_monthly_dealers
  FOR SELECT USING (public.wheeler_pump_can_view_client(client_id));
CREATE POLICY wheeler_pump_monthly_dealers_write ON public.wheeler_pump_monthly_dealers
  FOR ALL USING (public.is_wheeler()) WITH CHECK (public.is_wheeler());
REVOKE ALL ON public.wheeler_pump_monthly, public.wheeler_pump_monthly_dealers FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wheeler_pump_monthly, public.wheeler_pump_monthly_dealers TO authenticated;

ALTER TABLE public.wheeler_pump_uploads ADD COLUMN IF NOT EXISTS months text[] NOT NULL DEFAULT '{}';

-- New signature (two extra inputs with defaults), so the old 6-argument version is replaced.
DROP FUNCTION IF EXISTS public.save_report_rows(uuid, jsonb, jsonb, jsonb, jsonb, jsonb);
CREATE OR REPLACE FUNCTION public.save_report_rows(
  p_client uuid,
  p_upload jsonb,
  p_quarterly jsonb,
  p_quarterly_dealers jsonb,
  p_r12 jsonb,
  p_r12_dealers jsonb,
  p_monthly jsonb DEFAULT '[]'::jsonb,
  p_monthly_dealers jsonb DEFAULT '[]'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
declare v_upload uuid;
begin
  if not public.is_wheeler() then
    raise exception 'Only Wheeler team members can save data';
  end if;

  insert into wheeler_pump_uploads (client_id, created_by, label, files, quarters, r12_ends, months, locations, brands, row_count, dealer_rows, skipped, warnings)
  values (
    p_client, auth.uid(),
    coalesce(p_upload->>'label', (select coalesce(nullif(full_name, ''), email) from wheeler_pump_profiles where id = auth.uid())),
    coalesce(p_upload->'files', '[]'::jsonb),
    coalesce((select array_agg(distinct x->>'quarter') from jsonb_array_elements(p_quarterly) x), '{}'),
    coalesce((select array_agg(distinct x->>'end')     from jsonb_array_elements(p_r12) x), '{}'),
    coalesce((select array_agg(distinct x->>'month')   from jsonb_array_elements(p_monthly) x), '{}'),
    coalesce((select array_agg(distinct x->>'location') from (select * from jsonb_array_elements(p_quarterly) union all select * from jsonb_array_elements(p_r12) union all select * from jsonb_array_elements(p_monthly)) s(x)), '{}'),
    coalesce((select array_agg(distinct x->>'brand')    from (select * from jsonb_array_elements(p_quarterly) union all select * from jsonb_array_elements(p_r12) union all select * from jsonb_array_elements(p_monthly)) s(x)), '{}'),
    jsonb_array_length(p_quarterly) + jsonb_array_length(p_r12) + jsonb_array_length(p_monthly),
    jsonb_array_length(p_quarterly_dealers) + jsonb_array_length(p_r12_dealers) + jsonb_array_length(p_monthly_dealers),
    coalesce((select array_agg(value) from jsonb_array_elements_text(coalesce(p_upload->'skipped', '[]'::jsonb))), '{}'),
    coalesce((select array_agg(value) from jsonb_array_elements_text(coalesce(p_upload->'warnings', '[]'::jsonb))), '{}')
  ) returning id into v_upload;

  -- quarterly
  with g as (select distinct x->>'quarter' q, x->>'location' l, x->>'brand' b from jsonb_array_elements(p_quarterly) x)
  delete from wheeler_pump_quarterly t using g where t.client_id = p_client and t.quarter = g.q and t.location = g.l and t.brand = g.b;
  with g as (select distinct x->>'quarter' q, x->>'location' l, x->>'brand' b from jsonb_array_elements(p_quarterly) x)
  delete from wheeler_pump_quarterly_dealers t using g where t.client_id = p_client and t.quarter = g.q and t.location = g.l and t.brand = g.b;

  insert into wheeler_pump_quarterly (client_id, quarter, location, brand, line, local_sales, pumped_in, pumped_out, source, upload_id)
  select p_client, x->>'quarter', x->>'location', x->>'brand', x->>'line',
         sum((x->>'local')::int), sum((x->>'pin')::int), sum((x->>'pout')::int), max(x->>'source'), v_upload
  from jsonb_array_elements(p_quarterly) x
  group by x->>'quarter', x->>'location', x->>'brand', x->>'line';

  insert into wheeler_pump_quarterly_dealers (client_id, quarter, location, brand, direction, name, units, upload_id)
  select p_client, x->>'quarter', x->>'location', x->>'brand', x->>'dir', x->>'name', (x->>'units')::int, v_upload
  from jsonb_array_elements(p_quarterly_dealers) x;

  -- rolling 12
  with g as (select distinct x->>'end' e, x->>'location' l, x->>'brand' b from jsonb_array_elements(p_r12) x)
  delete from wheeler_pump_r12 t using g where t.client_id = p_client and t.period_end = g.e and t.location = g.l and t.brand = g.b;
  with g as (select distinct x->>'end' e, x->>'location' l, x->>'brand' b from jsonb_array_elements(p_r12) x)
  delete from wheeler_pump_r12_dealers t using g where t.client_id = p_client and t.period_end = g.e and t.location = g.l and t.brand = g.b;

  insert into wheeler_pump_r12 (client_id, period_end, period_start, location, brand, line, local_sales, pumped_in, pumped_out, source, upload_id)
  select p_client, x->>'end', max(x->>'start'), x->>'location', x->>'brand', x->>'line',
         sum((x->>'local')::int), sum((x->>'pin')::int), sum((x->>'pout')::int), max(x->>'source'), v_upload
  from jsonb_array_elements(p_r12) x
  group by x->>'end', x->>'location', x->>'brand', x->>'line';

  insert into wheeler_pump_r12_dealers (client_id, period_end, location, brand, direction, name, units, upload_id)
  select p_client, x->>'end', x->>'location', x->>'brand', x->>'dir', x->>'name', (x->>'units')::int, v_upload
  from jsonb_array_elements(p_r12_dealers) x;

  -- monthly
  with g as (select distinct x->>'month' m, x->>'location' l, x->>'brand' b from jsonb_array_elements(p_monthly) x)
  delete from wheeler_pump_monthly t using g where t.client_id = p_client and t.month = g.m and t.location = g.l and t.brand = g.b;
  with g as (select distinct x->>'month' m, x->>'location' l, x->>'brand' b from jsonb_array_elements(p_monthly) x)
  delete from wheeler_pump_monthly_dealers t using g where t.client_id = p_client and t.month = g.m and t.location = g.l and t.brand = g.b;

  insert into wheeler_pump_monthly (client_id, month, location, brand, line, local_sales, pumped_in, pumped_out, source, upload_id)
  select p_client, x->>'month', x->>'location', x->>'brand', x->>'line',
         sum((x->>'local')::int), sum((x->>'pin')::int), sum((x->>'pout')::int), max(x->>'source'), v_upload
  from jsonb_array_elements(p_monthly) x
  group by x->>'month', x->>'location', x->>'brand', x->>'line';

  insert into wheeler_pump_monthly_dealers (client_id, month, location, brand, direction, name, units, upload_id)
  select p_client, x->>'month', x->>'location', x->>'brand', x->>'dir', x->>'name', (x->>'units')::int, v_upload
  from jsonb_array_elements(p_monthly_dealers) x;

  return v_upload;
end $function$;

REVOKE ALL ON FUNCTION public.save_report_rows(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_report_rows(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) TO authenticated, service_role;
