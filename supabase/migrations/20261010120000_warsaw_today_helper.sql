-- Test-plan Phase 1 (testing-migration-date-rules): one SQL "today" for every date rule
-- (context/changes/testing-migration-date-rules/plan.md).
--
-- Why: each date rule wrote "today" inline as (now() at time zone 'Europe/Warsaw')::date. The functions
-- are security definer with search_path = '', so no test could move their clock, and a rule that slipped
-- to UTC (current_date) would fail its tests only when they ran between 22:00 and 24:00 UTC.
--
-- Rules:
-- - "Today" is the calendar date in Europe/Warsaw (docs/api.md). private.warsaw_date(p_at) maps an instant
--   to that date; private.warsaw_today() is private.warsaw_date(now()). Every date rule calls
--   private.warsaw_today(); supabase/tests/warsaw_today.test.sql fails when a function in public or private
--   derives a date any other way.
-- - Tests pin today by replacing private.warsaw_today() inside their transaction, as its owner (postgres),
--   so the boundary tests use a fixed date instead of the real one.
-- - The helpers live in the private schema, which PostgREST does not expose; anon and authenticated get no
--   usage on it and no execute on the helpers. Only the security definer functions below call them.
--
-- choose_plan_option, confirm_plan, ingest_weekly_plan and rate_meal are redefined with the same
-- signatures, behaviour and privileges; each body is its latest definition with the inline "today"
-- replaced by private.warsaw_today(). The one-off re-pick in 20261009090000 is a do block and stays as
-- shipped.

create schema private;

revoke all on schema private from public, anon, authenticated;

-- warsaw_date: the Europe/Warsaw calendar date of the instant p_at.
create or replace function private.warsaw_date(p_at timestamptz)
returns date
language sql
stable
set search_path = ''
as $$
  select (p_at at time zone 'Europe/Warsaw')::date;
$$;

revoke execute on function private.warsaw_date(timestamptz) from public, anon, authenticated;

-- warsaw_today: today in Europe/Warsaw, at the transaction's start (now()).
create or replace function private.warsaw_today()
returns date
language sql
stable
set search_path = ''
as $$
  select private.warsaw_date(now());
$$;

revoke execute on function private.warsaw_today() from public, anon, authenticated;

-- choose_plan_option and confirm_plan: unchanged from 20261003120000_plan_choices.sql except for the
-- cut-off's "today".
create or replace function public.choose_plan_option(p_option_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan_id uuid;
  v_week_start date;
  v_meal_date date;
  v_meal_type text;
  v_saved_at timestamptz;
begin
  -- Locking the plan row serializes concurrent choices (two devices) and re-deliveries of the week.
  select p.id, p.week_start, o.meal_date, o.meal_type
    into v_plan_id, v_week_start, v_meal_date, v_meal_type
    from public.plan_meal_options o
    join public.weekly_plans p
      on p.id = o.plan_id
   where o.id = p_option_id
     and p.user_id = auth.uid()
     for update of p;

  if v_plan_id is null then
    raise exception using errcode = 'P0002', message = 'not_found';
  end if;

  if v_week_start <= private.warsaw_today() then
    raise exception using errcode = '55000', message = 'plan_locked';
  end if;

  -- Two statements: the partial unique index is checked row by row, so the old choice must be
  -- cleared before the new one is set.
  update public.plan_meal_options
     set is_chosen = false
   where plan_id = v_plan_id
     and meal_date = v_meal_date
     and meal_type = v_meal_type
     and is_chosen;

  update public.plan_meal_options
     set is_chosen = true
   where id = p_option_id
     and plan_id = v_plan_id;

  -- A re-delivery that committed while this call waited for the lock has replaced the option rows.
  if not found then
    raise exception using errcode = 'P0002', message = 'not_found';
  end if;

  update public.weekly_plans
     set saved_at = now()
   where id = v_plan_id
  returning saved_at into v_saved_at;

  return v_saved_at;
end;
$$;

revoke execute on function public.choose_plan_option(uuid) from public, anon;
grant execute on function public.choose_plan_option(uuid) to authenticated;

-- confirm_plan: mark the plan saved without changing any choice (the user keeps MO's recommendations).
-- Returns the new saved_at. Same not_found and plan_locked errors as choose_plan_option.
create or replace function public.confirm_plan(p_plan_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_week_start date;
  v_saved_at timestamptz;
begin
  select p.week_start
    into v_week_start
    from public.weekly_plans p
   where p.id = p_plan_id
     and p.user_id = auth.uid()
     for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'not_found';
  end if;

  if v_week_start <= private.warsaw_today() then
    raise exception using errcode = '55000', message = 'plan_locked';
  end if;

  update public.weekly_plans
     set saved_at = now()
   where id = p_plan_id
  returning saved_at into v_saved_at;

  return v_saved_at;
end;
$$;

revoke execute on function public.confirm_plan(uuid) from public, anon;
grant execute on function public.confirm_plan(uuid) to authenticated;

-- ingest_weekly_plan: unchanged from 20261008180000_rating_ordered_defaults.sql except for the
-- week_started check's "today".
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
  v_existing_raw jsonb;
  v_saved_at timestamptz;
  v_kept jsonb := '[]'::jsonb;
  v_first boolean := false;
begin
  select u.id
    into v_user_id
    from auth.users u
   where u.email = lower(p_email)
     and u.is_sso_user = false
   limit 1;

  if v_user_id is null then
    raise exception using errcode = 'P0002', message = 'unknown_user';
  end if;

  -- Lock the user's plan for the week. When there is none, claim the week with an insert that does
  -- nothing on conflict: if a concurrent delivery stored it first, the loop reads it again, now locked,
  -- so a delivery racing a first delivery still goes through the rules below.
  loop
    select p.id, p.raw_payload, p.saved_at
      into v_plan_id, v_existing_raw, v_saved_at
      from public.weekly_plans p
     where p.user_id = v_user_id
       and p.week_start = p_week_start
       for update;
    exit when found;

    insert into public.weekly_plans as wp
      (user_id, provider, week_start, week_end, mo_run_id, raw_payload, received_at)
    values
      (v_user_id, p_provider, p_week_start, p_week_end, p_run_id, p_raw, now())
    on conflict (user_id, week_start) do nothing
    returning wp.id into v_plan_id;
    if found then
      v_first := true;
      exit;
    end if;
  end loop;

  if not v_first then
    if v_existing_raw is not distinct from p_raw then
      return v_plan_id;
    end if;

    if p_week_start <= private.warsaw_today() then
      raise exception using errcode = '55000', message = 'week_started';
    end if;

    -- Captured before the option rows are deleted below.
    if v_saved_at is not null then
      select coalesce(jsonb_agg(jsonb_build_object(
               'meal_date', o.meal_date,
               'meal_type', o.meal_type,
               'provider_meal_id', o.provider_meal_id)), '[]'::jsonb)
        into v_kept
        from public.plan_meal_options o
       where o.plan_id = v_plan_id
         and o.is_chosen;
    end if;

    -- saved_at is left alone: kept when saved, and already null otherwise.
    update public.weekly_plans
       set provider = p_provider,
           week_end = p_week_end,
           mo_run_id = p_run_id,
           raw_payload = p_raw,
           received_at = now()
     where id = v_plan_id;
  end if;

  delete from public.plan_meal_options where plan_id = v_plan_id;

  -- v_kept holds at most one row per slot (plan_meal_options_one_chosen_per_slot), so the left join
  -- never duplicates an option. It is empty unless the plan was saved.
  insert into public.plan_meal_options
    (plan_id, user_id, meal_date, meal_type, variant_index, provider_meal_id,
     name, composition, nutrition, score, justifications, is_recommended, is_chosen)
  select
    v_plan_id, v_user_id, r.meal_date, r.meal_type, r.variant_index, r.provider_meal_id,
    r.name, r.composition, r.nutrition, r.score, coalesce(r.justifications, '[]'::jsonb), r.is_recommended,
    r.slot_has_kept and r.is_kept and r.kept_rank = 1
  from (
    select
      o.*,
      k.provider_meal_id is not null as is_kept,
      bool_or(k.provider_meal_id is not null) over (partition by o.meal_date, o.meal_type) as slot_has_kept,
      row_number() over (
        partition by o.meal_date, o.meal_type, k.provider_meal_id is not null
        order by o.variant_index
      ) as kept_rank
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
    )
    left join jsonb_to_recordset(v_kept) as k(meal_date date, meal_type text, provider_meal_id text)
      on k.meal_date = o.meal_date
     and k.meal_type = o.meal_type
     and k.provider_meal_id = o.provider_meal_id
  ) as r;

  -- Every slot without a kept dish gets the suggested pick.
  perform public.pick_default_choices(v_plan_id);

  return v_plan_id;
end;
$$;

revoke execute on function public.ingest_weekly_plan(text, text, date, date, text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.ingest_weekly_plan(text, text, date, date, text, jsonb, jsonb)
  to service_role;

-- rate_meal: unchanged from 20261008180000_rating_ordered_defaults.sql except for v_today, which bounds
-- both the rateable window and the re-pick of plans that have not started.
create or replace function public.rate_meal(p_option_id uuid, p_rating smallint)
returns smallint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_provider text;
  v_provider_meal_id text;
  v_meal_date date;
  v_is_chosen boolean;
  v_today date := private.warsaw_today();
  v_rating smallint;
  v_plan_ids uuid[];
  v_plan_id uuid;
begin
  select p.user_id, p.provider, o.provider_meal_id, o.meal_date, o.is_chosen
    into v_user_id, v_provider, v_provider_meal_id, v_meal_date, v_is_chosen
    from public.plan_meal_options o
    join public.weekly_plans p
      on p.id = o.plan_id
   where o.id = p_option_id
     and p.user_id = auth.uid();

  if v_user_id is null then
    raise exception using errcode = 'P0002', message = 'not_found';
  end if;

  if not v_is_chosen or v_meal_date < v_today - 7 or v_meal_date > v_today then
    raise exception using errcode = '55000', message = 'not_rateable';
  end if;

  if p_rating is null then
    delete from public.meal_ratings where option_id = p_option_id;
    v_rating := null;
  else
    insert into public.meal_ratings as r (option_id, user_id, rating, rated_at)
    values (p_option_id, v_user_id, p_rating, now())
    on conflict (option_id) do update
      set rating = excluded.rating,
          rated_at = excluded.rated_at
    returning r.rating into v_rating;
  end if;

  -- The rated meal's own week has started (meal_date <= today), so it is never among these plans.
  select coalesce(array_agg(l.id order by l.week_start, l.id), '{}')
    into v_plan_ids
    from (
      select p.id, p.week_start
        from public.weekly_plans p
       where p.user_id = v_user_id
         and p.provider = v_provider
         and p.saved_at is null
         and p.week_start > v_today
         and exists (
           select 1
             from public.plan_meal_options o
            where o.plan_id = p.id
              and o.provider_meal_id = v_provider_meal_id
         )
       order by p.week_start, p.id
         for update
    ) as l;

  foreach v_plan_id in array v_plan_ids loop
    -- Re-checked under the lock: a plan saved or started meanwhile keeps its choices.
    continue when not exists (
      select 1
        from public.weekly_plans p
       where p.id = v_plan_id
         and p.saved_at is null
         and p.week_start > v_today
    );

    update public.plan_meal_options
       set is_chosen = false
     where plan_id = v_plan_id
       and is_chosen;

    perform public.pick_default_choices(v_plan_id);
  end loop;

  return v_rating;
end;
$$;

revoke execute on function public.rate_meal(uuid, smallint) from public, anon;
grant execute on function public.rate_meal(uuid, smallint) to authenticated;
