-- S-08 (rate-recent-meals): the user's rating of a meal they had, and the latest earlier rating of
-- each meal shown on later plans (context/changes/rate-recent-meals/plan.md).
--
-- Rules:
-- - A rating belongs to one option row (meal_ratings.option_id, at most one rating per option) on a
--   five-step scale, 1 (Never again) to 5 (Chef's kiss).
-- - Only the chosen option of a slot (is_chosen) can be rated: the meal the user had, not one only offered.
-- - Rateable window: today - 7 <= meal_date <= today in Europe/Warsaw, both ends inclusive. Any meal in
--   the window belongs to a week that has started, which MO can no longer re-send
--   (20261006120000_week_resubmission_rules.sql), so the rated option row is stable.
-- - The only write path is rate_meal(), a security definer function that checks ownership, chosen and
--   the window itself; users have no table grants for writes. Rating again replaces the rating and its
--   rated_at; rating null clears it.
-- - get_plan_ratings() shows, for each option of a plan, the rating of the same meal (same user,
--   weekly_plans.provider and provider_meal_id, as in get_plan_recency) from the most recent rated meal
--   day strictly before the option's meal_date. A later occurrence without a rating does not hide an
--   earlier rating, and re-rating an older occurrence does not override a newer occurrence's rating.
--   Unlike recency, the plan being saved does not matter: a rated meal was had.

create table public.meal_ratings (
  option_id uuid primary key references public.plan_meal_options on delete cascade,
  user_id uuid not null,
  rating smallint not null check (rating between 1 and 5),
  rated_at timestamptz not null default now()
);

alter table public.meal_ratings enable row level security;

create policy "meal_ratings_select_own_authenticated"
  on public.meal_ratings
  for select
  to authenticated
  using (user_id = (select auth.uid()));

revoke insert, update, delete, truncate on table public.meal_ratings from anon, authenticated;

-- rate_meal: store p_rating (1-5) as the user's rating of the chosen option p_option_id, or clear it
-- when p_rating is null. Returns the stored rating, or null after a clear. Raises not_found (P0002) for
-- a missing option or one of another user, not_rateable (55000) for an option that is not chosen or
-- whose meal_date is outside today - 7 .. today in Europe/Warsaw. A rating outside 1-5 fails the check
-- constraint (23514).
create or replace function public.rate_meal(p_option_id uuid, p_rating smallint)
returns smallint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_meal_date date;
  v_is_chosen boolean;
  v_today date := (now() at time zone 'Europe/Warsaw')::date;
  v_rating smallint;
begin
  select p.user_id, o.meal_date, o.is_chosen
    into v_user_id, v_meal_date, v_is_chosen
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
    return null;
  end if;

  insert into public.meal_ratings as r (option_id, user_id, rating, rated_at)
  values (p_option_id, v_user_id, p_rating, now())
  on conflict (option_id) do update
    set rating = excluded.rating,
        rated_at = excluded.rated_at
  returning r.rating into v_rating;

  return v_rating;
end;
$$;

revoke execute on function public.rate_meal(uuid, smallint) from public, anon;
grant execute on function public.rate_meal(uuid, smallint) to authenticated;

-- get_plan_ratings: for each option of one plan, the user's rating of the same meal from the most recent
-- rated meal day strictly before the option's meal_date; options without one are absent. Security
-- invoker, so the caller's RLS limits the plan, the history and the ratings to the caller's own rows.
-- Rated rows are always chosen, so h.is_chosen only lets the join use plan_meal_options_chosen_history_idx.
-- When the same meal was rated twice on one day (lunch and dinner), the later rated_at wins.
create or replace function public.get_plan_ratings(p_plan_id uuid)
returns table (option_id uuid, rating smallint)
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct on (o.id) o.id as option_id, r.rating
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
    join public.meal_ratings r
      on r.option_id = h.id
   where p.id = p_plan_id
   order by o.id, h.meal_date desc, r.rated_at desc;
$$;

revoke execute on function public.get_plan_ratings(uuid) from public, anon;
grant execute on function public.get_plan_ratings(uuid) to authenticated;
