begin;

create table if not exists public.quant_scores (
  symbol text primary key,
  date text,
  market text,
  name text,
  price numeric,
  per text,
  pbr text,
  gpa text,
  momentum_pct numeric,
  momentum_val numeric,
  rsi numeric,
  roe text,
  debt text,
  div_yield numeric,
  beta numeric,
  peg text,
  srim_price text,
  safety_margin text,
  is_etf boolean default false,
  quant_score numeric,
  per_val numeric,
  pbr_val numeric,
  gpa_val numeric,
  roe_val numeric,
  debt_val numeric,
  div_yield_val numeric,
  beta_val numeric,
  peg_val numeric,
  updated_at timestamptz default now()
);

alter table public.holdings enable row level security;
alter table public.settings enable row level security;
alter table public.quant_scores enable row level security;

drop policy if exists owner_read_holdings on public.holdings;
drop policy if exists owner_read_settings on public.settings;
drop policy if exists owner_read_quant_scores on public.quant_scores;

revoke all on table public.holdings from anon;
revoke all on table public.settings from anon;
revoke all on table public.quant_scores from anon;
revoke insert, update, delete, truncate, references, trigger on table public.holdings from authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.settings from authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.quant_scores from authenticated;

grant select on table public.holdings to authenticated;
grant select on table public.settings to authenticated;
grant select on table public.quant_scores to authenticated;

create policy owner_read_holdings
on public.holdings
for select
to authenticated
using (
  (select auth.jwt() -> 'app_metadata' ->> 'role') = 'owner'
  or lower(coalesce((select auth.jwt() ->> 'email'), '')) = 'tang4319@gmail.com'
);

create policy owner_read_settings
on public.settings
for select
to authenticated
using (
  (select auth.jwt() -> 'app_metadata' ->> 'role') = 'owner'
  or lower(coalesce((select auth.jwt() ->> 'email'), '')) = 'tang4319@gmail.com'
);

create policy owner_read_quant_scores
on public.quant_scores
for select
to authenticated
using (
  (select auth.jwt() -> 'app_metadata' ->> 'role') = 'owner'
  or lower(coalesce((select auth.jwt() ->> 'email'), '')) = 'tang4319@gmail.com'
);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'holdings'
  ) then
    alter publication supabase_realtime add table public.holdings;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'settings'
  ) then
    alter publication supabase_realtime add table public.settings;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'quant_scores'
  ) then
    alter publication supabase_realtime add table public.quant_scores;
  end if;
end
$$;

commit;

-- Optional hardening after the owner signs in once:
-- update auth.users
-- set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"owner"}'::jsonb
-- where email = 'tang4319@gmail.com';
