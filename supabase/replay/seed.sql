-- S-01 (testing-migration-date-rules): realistic rows for the migration replay
-- (scripts/migration-replay.sh, docs/testing.md "Migration replay"). The script loads this file at the
-- previous migration version, applies the newest migration, then runs supabase/replay/checks.test.sql
-- against the snapshot taken at the end of this file, and the full pgTAP suite over the same rows.
--
-- Rows are created only through the RPCs whose signatures supabase/tests/rpc_contract.test.sql pins
-- (ingest_weekly_plan, choose_plan_option, confirm_plan, rate_meal), never by inserting plans or options,
-- so the file stays valid at whichever version the replay starts from (20261008180000 or later). Only the
-- two users are inserted directly, as the delivery route needs an existing account.
--
-- Dates are relative to the real Warsaw today (T), as the base version's functions see it. This file runs
-- outside the pgTAP suite, so it may derive the date itself; it creates no function outside pg_temp.
--
-- Per user: two history weeks (A) or one (B), a current week, an upcoming week saved with a swapped
-- choice, and two unsaved upcoming weeks; ratings inside the window, one of which re-picks an unsaved
-- upcoming plan. Users, UUIDs and emails are distinct from every file in supabase/tests/.
\set ON_ERROR_STOP on

begin;

-- Day offsets are relative to today in Europe/Warsaw.
create function pg_temp.d(p_day int) returns date
language sql stable as $$ select (now() at time zone 'Europe/Warsaw')::date + p_day $$;

-- One option of the delivery payload.
create function pg_temp.o(p_day int, p_type text, p_variant int, p_meal text, p_score int, p_rec boolean)
returns jsonb
language sql stable as $$
  select jsonb_build_object('meal_date', pg_temp.d(p_day), 'meal_type', p_type, 'variant_index', p_variant,
    'provider_meal_id', p_meal, 'name', initcap(p_meal), 'score', p_score, 'is_recommended', p_rec)
$$;

-- A first delivery of the week starting at p_day, as the delivery route makes it.
create function pg_temp.send(p_email text, p_day int, p_week text, variadic p_options jsonb[])
returns uuid
language sql volatile as $$
  select public.ingest_weekly_plan(p_email, 'ntfy', pg_temp.d(p_day), pg_temp.d(p_day + 6), 'replay-1',
    jsonb_build_object('week', p_week, 'v', '1'), to_jsonb(p_options))
$$;

create function pg_temp.pid(p_user uuid, p_day int) returns uuid
language sql stable as $$
  select id from public.weekly_plans where user_id = p_user and week_start = pg_temp.d(p_day)
$$;

create function pg_temp.opt(p_user uuid, p_day int, p_type text, p_meal text) returns uuid
language sql stable as $$
  select id from public.plan_meal_options
   where user_id = p_user and meal_date = pg_temp.d(p_day) and meal_type = p_type and provider_meal_id = p_meal
$$;

create function pg_temp.chosen(p_user uuid, p_day int, p_type text) returns text
language sql stable as $$
  select provider_meal_id from public.plan_meal_options
   where user_id = p_user and meal_date = pg_temp.d(p_day) and meal_type = p_type and is_chosen
$$;

insert into auth.users (id, email) values
  ('cafe0000-0000-0000-0000-00000000000a', 'replay-a@test.local'),
  ('cafe0000-0000-0000-0000-00000000000b', 'replay-b@test.local');

-- Deliveries, all first deliveries (a first delivery of a started week is stored).
set local role service_role;

-- A: history at T-14 and T-7 (its meals T-7 and T-5 are inside the rating window), current week at T-3,
-- upcoming at T+4 (saved below), unsaved upcoming at T+11 (offers SOUP) and T+18 (does not).
select pg_temp.send('replay-a@test.local', -14, 'a-14',
  pg_temp.o(-14, 'lunch', 0, 'SOUP', 8, true), pg_temp.o(-14, 'lunch', 1, 'PASTA', 7, false),
  pg_temp.o(-13, 'dinner', 0, 'CURRY', 8, true), pg_temp.o(-13, 'dinner', 1, 'FISH', 6, false));
select pg_temp.send('replay-a@test.local', -7, 'a-7',
  pg_temp.o(-7, 'lunch', 0, 'SOUP', 8, true), pg_temp.o(-7, 'lunch', 1, 'PASTA', 7, false),
  pg_temp.o(-5, 'dinner', 0, 'CURRY', 9, true), pg_temp.o(-5, 'dinner', 1, 'SALAD', 6, false));
select pg_temp.send('replay-a@test.local', -3, 'a-3',
  pg_temp.o(-3, 'lunch', 0, 'STEW', 8, true), pg_temp.o(-3, 'lunch', 1, 'SOUP', 7, false),
  pg_temp.o(-1, 'dinner', 0, 'PIZZA', 8, true), pg_temp.o(-1, 'dinner', 1, 'FISH', 7, false),
  pg_temp.o(1, 'lunch', 0, 'TACO', 8, true), pg_temp.o(1, 'lunch', 1, 'RICE', 7, false));
select pg_temp.send('replay-a@test.local', 4, 'a+4',
  pg_temp.o(4, 'lunch', 0, 'SOUP', 9, true), pg_temp.o(4, 'lunch', 1, 'STEW', 7, false),
  pg_temp.o(5, 'dinner', 0, 'CURRY', 8, true), pg_temp.o(5, 'dinner', 1, 'FISH', 7, false));
select pg_temp.send('replay-a@test.local', 11, 'a+11',
  pg_temp.o(11, 'lunch', 0, 'SOUP', 9, true), pg_temp.o(11, 'lunch', 1, 'PASTA', 6, false),
  pg_temp.o(12, 'dinner', 0, 'CURRY', 8, true), pg_temp.o(12, 'dinner', 1, 'PIZZA', 7, false));
select pg_temp.send('replay-a@test.local', 18, 'a+18',
  pg_temp.o(18, 'lunch', 0, 'TACO', 8, true), pg_temp.o(18, 'lunch', 1, 'RICE', 7, false));

-- B: history at T-10, current week started yesterday (T-1), upcoming at T+6 (saved below), unsaved
-- upcoming at T+13 and T+20 (both offer WRAP).
select pg_temp.send('replay-b@test.local', -10, 'b-10',
  pg_temp.o(-10, 'lunch', 0, 'BURGER', 8, true), pg_temp.o(-10, 'lunch', 1, 'WRAP', 7, false));
select pg_temp.send('replay-b@test.local', -1, 'b-1',
  pg_temp.o(-1, 'lunch', 0, 'WRAP', 8, true), pg_temp.o(-1, 'lunch', 1, 'BURGER', 7, false),
  pg_temp.o(2, 'dinner', 0, 'RAMEN', 8, true), pg_temp.o(2, 'dinner', 1, 'PHO', 7, false));
select pg_temp.send('replay-b@test.local', 6, 'b+6',
  pg_temp.o(6, 'lunch', 0, 'RAMEN', 9, true), pg_temp.o(6, 'lunch', 1, 'WRAP', 6, false),
  pg_temp.o(7, 'dinner', 0, 'PHO', 8, true), pg_temp.o(7, 'dinner', 1, 'BURGER', 7, false));
select pg_temp.send('replay-b@test.local', 13, 'b+13',
  pg_temp.o(13, 'lunch', 0, 'WRAP', 9, true), pg_temp.o(13, 'lunch', 1, 'RAMEN', 7, false));
select pg_temp.send('replay-b@test.local', 20, 'b+20',
  pg_temp.o(20, 'dinner', 0, 'PHO', 8, true), pg_temp.o(20, 'dinner', 1, 'WRAP', 6, false));

reset role;

-- A: swaps the T+5 dinner to FISH (saves the plan), then rates. SOUP 1/5 (Never again) re-picks the
-- unsaved T+11 plan, whose lunch becomes PASTA; the saved T+4 plan keeps SOUP. STEW is rated twice, so
-- the stored rating is a replaced one.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"cafe0000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select public.choose_plan_option(pg_temp.opt('cafe0000-0000-0000-0000-00000000000a', 5, 'dinner', 'FISH'));
select public.rate_meal(pg_temp.opt('cafe0000-0000-0000-0000-00000000000a', -7, 'lunch', 'SOUP'), 1::smallint);
select public.rate_meal(pg_temp.opt('cafe0000-0000-0000-0000-00000000000a', -5, 'dinner', 'CURRY'), 5::smallint);
select public.rate_meal(pg_temp.opt('cafe0000-0000-0000-0000-00000000000a', -3, 'lunch', 'STEW'), 2::smallint);
select public.rate_meal(pg_temp.opt('cafe0000-0000-0000-0000-00000000000a', -3, 'lunch', 'STEW'), 4::smallint);
select public.rate_meal(pg_temp.opt('cafe0000-0000-0000-0000-00000000000a', -1, 'dinner', 'PIZZA'), 3::smallint);

-- B: swaps the T+7 dinner to BURGER and confirms the plan, then rates WRAP 5/5 (Chef's kiss), which
-- re-picks the unsaved T+20 plan to WRAP.
select set_config('request.jwt.claims', '{"sub":"cafe0000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
select public.choose_plan_option(pg_temp.opt('cafe0000-0000-0000-0000-00000000000b', 7, 'dinner', 'BURGER'));
select public.confirm_plan(pg_temp.pid('cafe0000-0000-0000-0000-00000000000b', 6));
select public.rate_meal(pg_temp.opt('cafe0000-0000-0000-0000-00000000000b', -1, 'lunch', 'WRAP'), 5::smallint);

reset role;

-- The seed is what the checks rely on, so it fails loudly when the base version's RPCs didn't produce it.
do $$
begin
  if pg_temp.chosen('cafe0000-0000-0000-0000-00000000000a', 5, 'dinner') is distinct from 'FISH'
     or pg_temp.chosen('cafe0000-0000-0000-0000-00000000000b', 7, 'dinner') is distinct from 'BURGER' then
    raise exception 'replay seed: a swap did not take';
  end if;
  if pg_temp.chosen('cafe0000-0000-0000-0000-00000000000a', 4, 'lunch') is distinct from 'SOUP' then
    raise exception 'replay seed: the saved plan was re-picked';
  end if;
  if pg_temp.chosen('cafe0000-0000-0000-0000-00000000000a', 11, 'lunch') is distinct from 'PASTA'
     or pg_temp.chosen('cafe0000-0000-0000-0000-00000000000b', 20, 'dinner') is distinct from 'WRAP' then
    raise exception 'replay seed: a rating did not re-pick the unsaved upcoming plan';
  end if;
  if (select count(*) from public.meal_ratings) <> 5 then
    raise exception 'replay seed: expected 5 ratings';
  end if;
end;
$$;

-- Snapshot, read by supabase/replay/checks.test.sql after the newest migration.
create schema replay_snapshot;

-- The chosen option per slot of every saved plan and every started week (week_start today or earlier).
-- Unsaved upcoming plans are left out: the system may still re-pick them (20261009090000 did).
create table replay_snapshot.chosen as
  select o.plan_id, o.meal_date, o.meal_type, o.provider_meal_id
    from public.plan_meal_options o
    join public.weekly_plans p on p.id = o.plan_id
   where o.is_chosen
     and (p.saved_at is not null or p.week_start <= pg_temp.d(0));

-- Every slot of every plan, so a migration that drops a slot's options can't pass the one-chosen check.
create table replay_snapshot.slots as
  select distinct plan_id, meal_date, meal_type from public.plan_meal_options;

create table replay_snapshot.ratings as
  select option_id, user_id, rating, rated_at from public.meal_ratings;

create table replay_snapshot.plans as
  select id as plan_id, saved_at, week_start, week_end from public.weekly_plans;

commit;
