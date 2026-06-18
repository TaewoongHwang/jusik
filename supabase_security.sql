begin;

create table if not exists public.holdings (
  symbol text not null,
  name text,
  quantity numeric,
  avg_price numeric,
  current_price numeric,
  purchase_amount numeric,
  eval_amount numeric,
  profit_loss_amount numeric,
  profit_loss_pct numeric,
  portfolio_weight_pct numeric,
  source text,
  currency text default 'KRW',
  change_pct numeric,
  updated_at timestamptz default now()
);

create table if not exists public.settings (
  key text primary key,
  value text,
  description text,
  updated_at timestamptz default now()
);

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

alter table public.holdings add column if not exists symbol text;
alter table public.holdings add column if not exists name text;
alter table public.holdings add column if not exists quantity numeric;
alter table public.holdings add column if not exists avg_price numeric;
alter table public.holdings add column if not exists current_price numeric;
alter table public.holdings add column if not exists purchase_amount numeric;
alter table public.holdings add column if not exists eval_amount numeric;
alter table public.holdings add column if not exists profit_loss_amount numeric;
alter table public.holdings add column if not exists profit_loss_pct numeric;
alter table public.holdings add column if not exists portfolio_weight_pct numeric;
alter table public.holdings add column if not exists source text;
alter table public.holdings add column if not exists currency text default 'KRW';
alter table public.holdings add column if not exists change_pct numeric;
alter table public.holdings add column if not exists updated_at timestamptz default now();

alter table public.settings add column if not exists key text;
alter table public.settings add column if not exists value text;
alter table public.settings add column if not exists description text;
alter table public.settings add column if not exists updated_at timestamptz default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.settings'::regclass
      and contype in ('p', 'u')
      and conkey = array[
        (select attnum from pg_attribute where attrelid = 'public.settings'::regclass and attname = 'key')
      ]::smallint[]
  ) then
    alter table public.settings add constraint settings_key_unique unique (key);
  end if;
end
$$;

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
  or lower(coalesce((select auth.jwt() -> 'user_metadata' ->> 'email'), '')) = 'tang4319@gmail.com'
);

create policy owner_read_settings
on public.settings
for select
to authenticated
using (
  (select auth.jwt() -> 'app_metadata' ->> 'role') = 'owner'
  or lower(coalesce((select auth.jwt() ->> 'email'), '')) = 'tang4319@gmail.com'
  or lower(coalesce((select auth.jwt() -> 'user_metadata' ->> 'email'), '')) = 'tang4319@gmail.com'
);

create policy owner_read_quant_scores
on public.quant_scores
for select
to authenticated
using (
  (select auth.jwt() -> 'app_metadata' ->> 'role') = 'owner'
  or lower(coalesce((select auth.jwt() ->> 'email'), '')) = 'tang4319@gmail.com'
  or lower(coalesce((select auth.jwt() -> 'user_metadata' ->> 'email'), '')) = 'tang4319@gmail.com'
);

update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"owner"}'::jsonb
where lower(email) = 'tang4319@gmail.com';

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

select 'holdings rows' as label, count(*)::text as value from public.holdings
union all
select 'settings rows' as label, count(*)::text as value from public.settings
union all
select 'owner role users' as label, count(*)::text as value
from auth.users
where lower(email) = 'tang4319@gmail.com'
  and raw_app_meta_data ->> 'role' = 'owner';
