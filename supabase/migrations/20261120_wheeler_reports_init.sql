-- Wheeler Reports: marketing report schema (prefixed to coexist with Smart Analytics).
-- Safe to run once. Does not create a global is_admin() / profiles table.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Clients and stores
-- ---------------------------------------------------------------------------
create table if not exists public.wheeler_reports_clients (
  id                      uuid primary key default gen_random_uuid(),
  slug                    text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name                    text not null,
  timezone                text not null default 'America/New_York',
  google_ads_customer_id  text,
  meta_ad_account_id      text,
  created_at              timestamptz not null default now()
);

create table if not exists public.wheeler_reports_stores (
  id                   uuid primary key default gen_random_uuid(),
  client_id            uuid not null references public.wheeler_reports_clients(id) on delete cascade,
  name                 text not null,
  sort                 int  not null default 0,
  campaign_terms       text[] not null default '{}',
  lead_locations       text[] not null default '{}',
  unique (client_id, name)
);

-- ---------------------------------------------------------------------------
-- Users: Wheeler admin sees every client; a client user sees only theirs.
-- ---------------------------------------------------------------------------
create table if not exists public.wheeler_reports_profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text,
  role       text not null default 'client' check (role in ('admin', 'client')),
  client_id  uuid references public.wheeler_reports_clients(id) on delete set null,
  created_at timestamptz not null default now()
);

create or replace function public.wheeler_reports_handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.wheeler_reports_profiles (user_id, email)
  values (new.id, new.email)
  on conflict do nothing;
  return new;
end $$;

drop trigger if exists wheeler_reports_on_auth_user_created on auth.users;
create trigger wheeler_reports_on_auth_user_created
  after insert on auth.users
  for each row execute function public.wheeler_reports_handle_new_user();

create or replace function public.wheeler_reports_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.wheeler_reports_profiles
    where user_id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.wheeler_reports_can_see_client(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.wheeler_reports_is_admin()
    or exists (
      select 1 from public.wheeler_reports_profiles
      where user_id = auth.uid() and client_id = c
    );
$$;

-- ---------------------------------------------------------------------------
-- Website leads
-- ---------------------------------------------------------------------------
create table if not exists public.wheeler_reports_leads (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.wheeler_reports_clients(id) on delete cascade,
  store_id      uuid references public.wheeler_reports_stores(id) on delete set null,
  external_id   text not null,
  lead_date     date not null,
  created_at_utc timestamptz,
  source        text not null default '',
  medium        text not null default '',
  campaign      text not null default '',
  lead_type     text not null default '',
  form          text not null default '',
  person_hash   text,
  imported_at   timestamptz not null default now(),
  unique (client_id, external_id)
);
create index if not exists wheeler_reports_leads_client_date
  on public.wheeler_reports_leads (client_id, lead_date);

-- ---------------------------------------------------------------------------
-- Ad platform stats
-- ---------------------------------------------------------------------------
create table if not exists public.wheeler_reports_ad_stats (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references public.wheeler_reports_clients(id) on delete cascade,
  platform        text not null check (platform in ('google', 'meta')),
  date_from       date not null,
  date_to         date not null,
  campaign_id     text not null,
  campaign_name   text not null default '',
  channel         text not null default '',
  campaign_group  text not null default '',
  store_id        uuid references public.wheeler_reports_stores(id) on delete set null,
  cost            numeric(14, 2) not null default 0,
  impressions     bigint not null default 0,
  clicks          bigint not null default 0,
  search_impression_share numeric(8, 6),
  platform_leads  numeric(12, 2),
  source          text not null default 'api' check (source in ('api', 'upload', 'manual')),
  updated_at      timestamptz not null default now(),
  check (date_to >= date_from),
  unique (client_id, platform, campaign_id, date_from, date_to)
);
create index if not exists wheeler_reports_ad_stats_client_dates
  on public.wheeler_reports_ad_stats (client_id, platform, date_from, date_to);

-- ---------------------------------------------------------------------------
-- Monthly figures
-- ---------------------------------------------------------------------------
create table if not exists public.wheeler_reports_media_spend (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references public.wheeler_reports_clients(id) on delete cascade,
  store_id   uuid not null references public.wheeler_reports_stores(id) on delete cascade,
  month      date not null check (extract(day from month) = 1),
  amount     numeric(14, 2) not null check (amount >= 0),
  unique (client_id, store_id, month)
);

create table if not exists public.wheeler_reports_sales (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references public.wheeler_reports_clients(id) on delete cascade,
  store_id   uuid not null references public.wheeler_reports_stores(id) on delete cascade,
  date_from  date not null,
  date_to    date not null,
  units      numeric(10, 2) not null check (units >= 0),
  created_at timestamptz not null default now(),
  check (date_to >= date_from),
  unique (client_id, store_id, date_from, date_to)
);
create index if not exists wheeler_reports_sales_client_dates
  on public.wheeler_reports_sales (client_id, date_from, date_to);

-- ---------------------------------------------------------------------------
-- Other costs
-- ---------------------------------------------------------------------------
create table if not exists public.wheeler_reports_cost_heads (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid references public.wheeler_reports_clients(id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists wheeler_reports_cost_heads_unique
  on public.wheeler_reports_cost_heads (
    coalesce(client_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(name)
  );

create table if not exists public.wheeler_reports_other_costs (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.wheeler_reports_clients(id) on delete cascade,
  store_id    uuid references public.wheeler_reports_stores(id) on delete cascade,
  month       date not null check (extract(day from month) = 1),
  head        text not null,
  amount      numeric(14, 2) not null check (amount > 0),
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists wheeler_reports_other_costs_client_month
  on public.wheeler_reports_other_costs (client_id, month);

-- ---------------------------------------------------------------------------
-- Sync log
-- ---------------------------------------------------------------------------
create table if not exists public.wheeler_reports_sync_runs (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid references public.wheeler_reports_clients(id) on delete cascade,
  kind        text not null,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  status      text not null default 'running' check (status in ('running', 'ok', 'error')),
  rows        int,
  message     text
);
create index if not exists wheeler_reports_sync_runs_client
  on public.wheeler_reports_sync_runs (client_id, started_at desc);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.wheeler_reports_clients     enable row level security;
alter table public.wheeler_reports_stores      enable row level security;
alter table public.wheeler_reports_profiles    enable row level security;
alter table public.wheeler_reports_leads       enable row level security;
alter table public.wheeler_reports_ad_stats    enable row level security;
alter table public.wheeler_reports_media_spend enable row level security;
alter table public.wheeler_reports_sales       enable row level security;
alter table public.wheeler_reports_cost_heads  enable row level security;
alter table public.wheeler_reports_other_costs enable row level security;
alter table public.wheeler_reports_sync_runs   enable row level security;

drop policy if exists wheeler_reports_clients_read on public.wheeler_reports_clients;
drop policy if exists wheeler_reports_clients_admin on public.wheeler_reports_clients;
create policy wheeler_reports_clients_read on public.wheeler_reports_clients
  for select using (public.wheeler_reports_can_see_client(id));
create policy wheeler_reports_clients_admin on public.wheeler_reports_clients
  for all using (public.wheeler_reports_is_admin()) with check (public.wheeler_reports_is_admin());

drop policy if exists wheeler_reports_profiles_self on public.wheeler_reports_profiles;
drop policy if exists wheeler_reports_profiles_admin on public.wheeler_reports_profiles;
create policy wheeler_reports_profiles_self on public.wheeler_reports_profiles
  for select using (user_id = auth.uid() or public.wheeler_reports_is_admin());
create policy wheeler_reports_profiles_admin on public.wheeler_reports_profiles
  for all using (public.wheeler_reports_is_admin()) with check (public.wheeler_reports_is_admin());

do $$
declare t text;
begin
  foreach t in array array[
    'wheeler_reports_stores',
    'wheeler_reports_leads',
    'wheeler_reports_ad_stats',
    'wheeler_reports_media_spend',
    'wheeler_reports_sales',
    'wheeler_reports_sync_runs'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format(
      'create policy %I on public.%I for select using (public.wheeler_reports_can_see_client(client_id))',
      t || '_read', t
    );
    execute format(
      'create policy %I on public.%I for all using (public.wheeler_reports_is_admin()) with check (public.wheeler_reports_is_admin())',
      t || '_admin', t
    );
  end loop;
end $$;

drop policy if exists wheeler_reports_other_costs_read on public.wheeler_reports_other_costs;
drop policy if exists wheeler_reports_other_costs_insert on public.wheeler_reports_other_costs;
drop policy if exists wheeler_reports_other_costs_delete on public.wheeler_reports_other_costs;
drop policy if exists wheeler_reports_other_costs_admin on public.wheeler_reports_other_costs;
create policy wheeler_reports_other_costs_read on public.wheeler_reports_other_costs
  for select using (public.wheeler_reports_can_see_client(client_id));
create policy wheeler_reports_other_costs_insert on public.wheeler_reports_other_costs
  for insert with check (public.wheeler_reports_can_see_client(client_id));
create policy wheeler_reports_other_costs_delete on public.wheeler_reports_other_costs
  for delete using (public.wheeler_reports_can_see_client(client_id));
create policy wheeler_reports_other_costs_admin on public.wheeler_reports_other_costs
  for update using (public.wheeler_reports_is_admin()) with check (public.wheeler_reports_is_admin());

drop policy if exists wheeler_reports_cost_heads_read on public.wheeler_reports_cost_heads;
drop policy if exists wheeler_reports_cost_heads_insert on public.wheeler_reports_cost_heads;
drop policy if exists wheeler_reports_cost_heads_admin on public.wheeler_reports_cost_heads;
create policy wheeler_reports_cost_heads_read on public.wheeler_reports_cost_heads
  for select using (client_id is null or public.wheeler_reports_can_see_client(client_id));
create policy wheeler_reports_cost_heads_insert on public.wheeler_reports_cost_heads
  for insert with check (client_id is not null and public.wheeler_reports_can_see_client(client_id));
create policy wheeler_reports_cost_heads_admin on public.wheeler_reports_cost_heads
  for all using (public.wheeler_reports_is_admin()) with check (public.wheeler_reports_is_admin());

-- Default cost heads (idempotent)
insert into public.wheeler_reports_cost_heads (client_id, name)
select null, v.name
from (values
  ('Radio'), ('TV'), ('Billboard'), ('Print'), ('Direct mail'),
  ('Event / show'), ('Third-party listing'), ('Streaming Video'), ('All Other Wheeler Fees')
) as v(name)
where not exists (
  select 1 from public.wheeler_reports_cost_heads h
  where h.client_id is null and lower(h.name) = lower(v.name)
);

revoke all on public.wheeler_reports_clients, public.wheeler_reports_stores,
  public.wheeler_reports_profiles, public.wheeler_reports_leads,
  public.wheeler_reports_ad_stats, public.wheeler_reports_media_spend,
  public.wheeler_reports_sales, public.wheeler_reports_cost_heads,
  public.wheeler_reports_other_costs, public.wheeler_reports_sync_runs
  from anon;
grant select, insert, update, delete on
  public.wheeler_reports_clients, public.wheeler_reports_stores,
  public.wheeler_reports_profiles, public.wheeler_reports_leads,
  public.wheeler_reports_ad_stats, public.wheeler_reports_media_spend,
  public.wheeler_reports_sales, public.wheeler_reports_cost_heads,
  public.wheeler_reports_other_costs, public.wheeler_reports_sync_runs
  to authenticated;

grant execute on function public.wheeler_reports_is_admin() to authenticated;
grant execute on function public.wheeler_reports_can_see_client(uuid) to authenticated;

-- Existing auth users (created before this module) need a profile row too.
insert into public.wheeler_reports_profiles (user_id, email)
select u.id, u.email
from auth.users u
on conflict (user_id) do nothing;
