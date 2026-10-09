-- S-13 (rating-ordered-options): the default choice of a slot is mo-web's suggested pick, MO's score
-- adjusted by the user's own rating of the meal, not MO's recommendation
-- (context/changes/rating-ordered-options/plan.md).
--
-- Rules:
-- - Adjusted score (adjusted_score): MO's score (1-10) plus 100 for a meal rated 5 (Chef's kiss), minus 100
--   for 1 (Never again), plus 2 for 4, minus 2 for 2; a meal rated 3 or never rated keeps its score. So a
--   5/5 meal always comes first and a 1/5 meal always last, while MO's score still orders meals inside
--   those bands.
-- - The rating that counts is the one get_plan_ratings shows: the user's rating of the same meal (same
--   user, weekly_plans.provider and provider_meal_id) from the most recent rated meal day strictly before
--   the option's meal_date; when one day has two ratings, the later rated_at wins.
-- - Suggested pick of a slot (pick_default_choices): the option with the highest adjusted score, then the
--   highest MO score, then the lowest variant_index. Without ratings it is MO's top-scored option.
-- - ingest_weekly_plan stores the suggested pick as is_chosen in every slot of a never-saved plan, and in
--   each slot of a saved plan whose kept dish is no longer offered (or that is new in the re-send).
--   is_recommended stays MO's pick as delivered.
-- - rate_meal re-picks every plan of the caller that is not saved (saved_at is null), has not started
--   (week_start after today in Europe/Warsaw), has the rated meal's provider and offers the rated meal:
--   its chosen rows are cleared and every slot gets the suggested pick again. A saved plan and a started
--   week (the rated meal's own week included) are never re-picked.
-- - Existing plans are not re-picked by this migration.
--
-- get_plan_ratings, choose_plan_option and confirm_plan are unchanged.

-- adjusted_score: MO's score adjusted by the user's rating (null: never rated).
create or replace function public.adjusted_score(p_score smallint, p_rating smallint)
returns integer
language sql
immutable
set search_path = ''
as $$
  select p_score + case p_rating
                     when 5 then 100
                     when 1 then -100
                     when 4 then 2
                     when 2 then -2
                     else 0
                   end
$$;

revoke execute on function public.adjusted_score(smallint, smallint) from public, anon;

-- pick_default_choices: in every slot (meal_date, meal_type) of p_plan_id without a chosen option, choose
-- the suggested pick. Slots that already have a chosen option are left alone, so a caller decides which
-- slots to re-pick by clearing their is_chosen first (in a separate statement, as the partial unique index
-- plan_meal_options_one_chosen_per_slot is checked row by row). Security definer, so the rating lookup is
-- limited to the plan's user by the joins instead of RLS; only other definer functions call it.
create or replace function public.pick_default_choices(p_plan_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  with ratings as (
    -- As get_plan_ratings, for the plan's user.
    select distinct on (o.id) o.id as option_id, r.rating
      from public.weekly_plans p
      join public.plan_meal_options o
        on o.plan_id = p.id
      join public.plan_meal_options h
        on h.user_id = p.user_id
       and h.provider_meal_id = o.provider_meal_id
       and h.is_chosen
       and h.meal_date < o.meal_date
      join public.weekly_plans hp
        on hp.id = h.plan_id
       and hp.user_id = p.user_id
       and hp.provider = p.provider
      join public.meal_ratings r
        on r.option_id = h.id
     where p.id = p_plan_id
     order by o.id, h.meal_date desc, r.rated_at desc
  ),
  picks as (
    select distinct on (o.meal_date, o.meal_type) o.id
      from public.plan_meal_options o
      left join ratings rt
        on rt.option_id = o.id
     where o.plan_id = p_plan_id
       and not exists (
         select 1
           from public.plan_meal_options c
          where c.plan_id = o.plan_id
            and c.meal_date = o.meal_date
            and c.meal_type = o.meal_type
            and c.is_chosen
       )
     order by o.meal_date, o.meal_type,
              public.adjusted_score(o.score, rt.rating) desc, o.score desc, o.variant_index asc
  )
  update public.plan_meal_options
     set is_chosen = true
   where id in (select id from picks);
$$;

revoke execute on function public.pick_default_choices(uuid) from public, anon, authenticated;

-- ingest_weekly_plan: rules of 20261006120000_week_resubmission_rules.sql, checked in this order against
-- the user's existing plan for p_week_start (locked first; a week not stored yet is claimed with an insert
-- that does nothing on conflict):
-- - Identical: the stored raw_payload equals p_raw. Returns the existing plan id and writes nothing.
-- - Started: the week's Monday is today or earlier in Europe/Warsaw. Raises week_started (55000) and
--   stores nothing. A first delivery of a started week is still stored.
-- - Otherwise the plan row is updated and its option rows re-created:
--   - never saved (saved_at is null): every slot gets the suggested pick (pick_default_choices),
--     saved_at stays null;
--   - saved (saved_at is not null, by a swap or by confirm_plan): saved_at is kept, and in each slot
--     (meal_date, meal_type) the option with the previously chosen provider_meal_id is chosen when the new
--     delivery offers it there (the lowest variant_index if it is offered more than once), otherwise the
--     suggested pick. A slot new in the re-send gets the suggested pick.
--
-- Changed from 20261006120000: the option insert chooses only the kept dishes, then pick_default_choices
-- fills every other slot. The rest of the body is unchanged.
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

-- rate_meal: store p_rating (1-5) as the user's rating of the chosen option p_option_id, or clear it
-- when p_rating is null. Returns the stored rating, or null after a clear. Raises not_found (P0002) for
-- a missing option or one of another user, not_rateable (55000) for an option that is not chosen or
-- whose meal_date is outside today - 7 .. today in Europe/Warsaw. A rating outside 1-5 fails the check
-- constraint (23514).
--
-- Changed from 20261008120000_meal_ratings.sql: after the rating is stored or cleared, the caller's
-- unsaved, not started plans of the same provider that offer the same meal are re-picked
-- (pick_default_choices). They are locked in one statement ordered by week_start and id, so two
-- concurrent ratings can't deadlock; a plan saved or started while this call waited is skipped.
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
  v_today date := (now() at time zone 'Europe/Warsaw')::date;
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
