-- S-03 (swap-and-save-plan): the user's choice per meal slot and the plan's save time.
--
-- Rules:
-- - One chosen option per slot (plan, meal_date, meal_type), stored as plan_meal_options.is_chosen
--   next to MO's is_recommended. Every delivered slot starts with the recommended option chosen.
-- - A plan is editable while week_start > today in Europe/Warsaw. The two write paths,
--   choose_plan_option() and confirm_plan(), are security definer functions that check ownership
--   and the cut-off themselves; users still have no table grants for writes.
-- - Re-delivery of a week resets it: ingest re-creates the option rows with is_chosen = is_recommended
--   and sets saved_at back to null (never saved).
-- - Recency (get_plan_recency) now counts a meal as planned when the user chose it.

alter table public.plan_meal_options
  add column is_chosen boolean not null default false;

update public.plan_meal_options set is_chosen = is_recommended;

create unique index plan_meal_options_one_chosen_per_slot
  on public.plan_meal_options (plan_id, meal_date, meal_type)
  where is_chosen;

alter table public.weekly_plans
  add column saved_at timestamptz;

-- The recency join filters h.user_id, h.provider_meal_id and h.meal_date on chosen rows only.
drop index public.plan_meal_options_user_meal_date_idx;

create index plan_meal_options_chosen_history_idx
  on public.plan_meal_options (user_id, provider_meal_id, meal_date)
  where is_chosen;

-- ingest_weekly_plan: body unchanged from 20261002170000_ingest_weekly_plan_email_index.sql, except that
-- options start with is_chosen = is_recommended and a re-delivered week gets saved_at = null.
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
   where u.email = lower(p_email)
     and u.is_sso_user = false
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
        received_at = excluded.received_at,
        saved_at = null
  returning wp.id into v_plan_id;

  delete from public.plan_meal_options where plan_id = v_plan_id;

  insert into public.plan_meal_options
    (plan_id, user_id, meal_date, meal_type, variant_index, provider_meal_id,
     name, composition, nutrition, score, justifications, is_recommended, is_chosen)
  select
    v_plan_id, v_user_id, o.meal_date, o.meal_type, o.variant_index, o.provider_meal_id,
    o.name, o.composition, o.nutrition, o.score, coalesce(o.justifications, '[]'::jsonb), o.is_recommended,
    o.is_recommended
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

-- choose_plan_option: make p_option_id the chosen option of its slot and mark the plan saved.
-- Returns the new saved_at. Raises not_found (P0002) for a missing option or one of another user,
-- plan_locked (55000) once the week has started in Europe/Warsaw.
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

  if v_week_start <= (now() at time zone 'Europe/Warsaw')::date then
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

  if v_week_start <= (now() at time zone 'Europe/Warsaw')::date then
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

-- get_plan_recency (S-02): for each option of one plan, the most recent earlier date the same meal
-- was planned for the same user. Security invoker, so the caller's RLS limits both the plan and the
-- history to the caller's own rows.
--
-- Same meal: equal weekly_plans.provider and plan_meal_options.provider_meal_id.
-- Earlier: meal_date strictly before the option's meal_date, in any plan.
-- Planned = is_chosen: the option the user chose for its slot (MO's recommendation until they swap).
-- An option that was only offered, or recommended but swapped away, does not count.
create or replace function public.get_plan_recency(p_plan_id uuid)
returns table (option_id uuid, last_planned_on date)
language sql
stable
security invoker
set search_path = ''
as $$
  select o.id as option_id, max(h.meal_date) as last_planned_on
    from public.weekly_plans p
    join public.plan_meal_options o
      on o.plan_id = p.id
    join public.plan_meal_options h
      on h.user_id = o.user_id
     and h.provider_meal_id = o.provider_meal_id
     and h.is_chosen
     and h.meal_date < o.meal_date
    join public.weekly_plans hp
      on hp.id = h.plan_id
     and hp.user_id = p.user_id
     and hp.provider = p.provider
   where p.id = p_plan_id
   group by o.id;
$$;

revoke execute on function public.get_plan_recency(uuid) from public, anon;
grant execute on function public.get_plan_recency(uuid) to authenticated;
