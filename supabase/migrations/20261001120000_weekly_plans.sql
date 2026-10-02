-- S-01 (mo-weekly-delivery): weekly plans delivered by Meal Orchestrator.
-- One plan per user and week with every menu option normalized, so recency
-- lookups and swaps are indexed SQL. Users can only read their own rows; the
-- only write path is ingest_weekly_plan(), executable by service_role alone.

create table public.weekly_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  provider text not null,
  week_start date not null,
  week_end date not null,
  mo_run_id text,
  raw_payload jsonb not null,
  received_at timestamptz not null default now(),
  unique (user_id, week_start)
);

create table public.plan_meal_options (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.weekly_plans on delete cascade,
  user_id uuid not null,
  meal_date date not null,
  meal_type text not null,
  variant_index smallint not null,
  provider_meal_id text not null,
  name text not null,
  composition text,
  nutrition jsonb,
  score smallint not null check (score between 1 and 10),
  justifications jsonb not null default '[]',
  is_recommended boolean not null,
  unique (plan_id, meal_date, meal_type, variant_index)
);

create index plan_meal_options_user_meal_date_idx
  on public.plan_meal_options (user_id, provider_meal_id, meal_date);

alter table public.weekly_plans enable row level security;
alter table public.plan_meal_options enable row level security;

create policy "weekly_plans_select_own_authenticated"
  on public.weekly_plans
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "plan_meal_options_select_own_authenticated"
  on public.plan_meal_options
  for select
  to authenticated
  using (user_id = (select auth.uid()));

revoke insert, update, delete, truncate on table public.weekly_plans from anon, authenticated;
revoke insert, update, delete, truncate on table public.plan_meal_options from anon, authenticated;

create or replace function public.ingest_weekly_plan(
  p_email text,
  p_provider text,
  p_week_start date,
  p_week_end date,
  p_run_id text,
  p_raw jsonb,
  p_options jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_plan_id uuid;
begin
  select u.id
    into v_user_id
    from auth.users u
   where lower(u.email) = lower(p_email)
   limit 1;

  if v_user_id is null then
    raise exception using errcode = 'P0002', message = 'unknown_user';
  end if;

  insert into public.weekly_plans as wp
    (user_id, provider, week_start, week_end, mo_run_id, raw_payload, received_at)
  values
    (v_user_id, p_provider, p_week_start, p_week_end, p_run_id, p_raw, now())
  on conflict (user_id, week_start) do update
    set provider = excluded.provider,
        week_end = excluded.week_end,
        mo_run_id = excluded.mo_run_id,
        raw_payload = excluded.raw_payload,
        received_at = excluded.received_at
  returning wp.id into v_plan_id;

  delete from public.plan_meal_options where plan_id = v_plan_id;

  insert into public.plan_meal_options
    (plan_id, user_id, meal_date, meal_type, variant_index, provider_meal_id,
     name, composition, nutrition, score, justifications, is_recommended)
  select
    v_plan_id, v_user_id, o.meal_date, o.meal_type, o.variant_index, o.provider_meal_id,
    o.name, o.composition, o.nutrition, o.score, coalesce(o.justifications, '[]'::jsonb), o.is_recommended
  from jsonb_to_recordset(p_options) as o(
    meal_date date,
    meal_type text,
    variant_index smallint,
    provider_meal_id text,
    name text,
    composition text,
    nutrition jsonb,
    score smallint,
    justifications jsonb,
    is_recommended boolean
  );

  return v_plan_id;
end;
$$;

revoke execute on function public.ingest_weekly_plan(text, text, date, date, text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.ingest_weekly_plan(text, text, date, date, text, jsonb, jsonb)
  to service_role;
