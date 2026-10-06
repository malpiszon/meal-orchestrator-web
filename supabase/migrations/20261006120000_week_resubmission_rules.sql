-- S-06 (week-resubmission-replace): rules for a week MO delivers again. Covers FR-017 and FR-018.
--
-- Rules, checked in this order against the user's existing plan for p_week_start (locked first, so a
-- concurrent choose_plan_option or confirm_plan and a re-send serialize; a week not stored yet is
-- claimed with an insert that does nothing on conflict, so two concurrent first deliveries serialize too):
-- - Identical: the stored raw_payload equals p_raw (jsonb equality, so whitespace and key order don't
--   matter). Returns the existing plan id and writes nothing: received_at, saved_at, mo_run_id and the
--   option rows stay as they are. An identical retry of a started week is therefore answered too.
-- - Started: the week's Monday is today or earlier in Europe/Warsaw (the cut-off of choose_plan_option
--   and confirm_plan). Raises week_started (55000) and stores nothing, so a week the user is already
--   eating, and the history that recency notes count, is never overwritten. A first delivery of a
--   started week is still stored.
-- - Otherwise the plan row is updated and its option rows re-created (as before):
--   - never saved (saved_at is null): is_chosen = is_recommended, saved_at stays null;
--   - saved (saved_at is not null, by a swap or by confirm_plan): saved_at is kept, and in each slot
--     (meal_date, meal_type) the option with the previously chosen provider_meal_id is chosen when
--     the new delivery offers it there (the lowest variant_index if it is offered more than once),
--     otherwise MO's new recommendation. A slot new in the re-send gets the recommendation.
--
-- The plan row is now inserted or updated separately instead of upserted, and the option insert picks
-- is_chosen by the carry-over; the rest of the body is unchanged from 20261003120000_plan_choices.sql.
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

    if p_week_start <= (now() at time zone 'Europe/Warsaw')::date then
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
    case
      when r.slot_has_kept then r.is_kept and r.kept_rank = 1
      else r.is_recommended
    end
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

  return v_plan_id;
end;
$$;

revoke execute on function public.ingest_weekly_plan(text, text, date, date, text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.ingest_weekly_plan(text, text, date, date, text, jsonb, jsonb)
  to service_role;
