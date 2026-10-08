-- S-08: pins the rules of rate_meal (ownership, chosen only, the today - 7 .. today window in
-- Europe/Warsaw, change and clear) and get_plan_ratings ("latest" = the most recent rated meal day
-- before the option's), see context/changes/rate-recent-meals/plan.md. Window dates are relative to
-- today in Europe/Warsaw, so the test never ages; the "latest" fixtures use fixed dates and are written
-- as the table owner, outside the window. Run with `npx supabase test db`.
begin;
select plan(32);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'ratings-a@test.local'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'ratings-b@test.local'),
  ('cccccccc-0000-0000-0000-000000000003', 'ratings-c@test.local');

-- Window fixtures (user A, user B), relative to today (T). Plan rows need not start on a Monday here.
-- 10..01: user A, starts T - 8 (T - 8 and T - 7). 10..02: user A, starts T (T and T + 1).
-- 20..01: user B, starts T.
insert into public.weekly_plans (id, user_id, provider, week_start, week_end, raw_payload) values
  ('10000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'ntfy',
   (now() at time zone 'Europe/Warsaw')::date - 8, (now() at time zone 'Europe/Warsaw')::date - 4, '{}'),
  ('10000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'ntfy',
   (now() at time zone 'Europe/Warsaw')::date, (now() at time zone 'Europe/Warsaw')::date + 4, '{}'),
  ('20000000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'ntfy',
   (now() at time zone 'Europe/Warsaw')::date, (now() at time zone 'Europe/Warsaw')::date + 4, '{}');

insert into public.plan_meal_options
  (id, plan_id, user_id, meal_date, meal_type, variant_index, provider_meal_id, name, score, is_recommended, is_chosen)
values
  -- User A: T - 8 lunch (chosen), T - 7 lunch (X chosen, Y only offered).
  ('a1000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   (now() at time zone 'Europe/Warsaw')::date - 8, 'lunch', 0, 'X', 'X', 8, true, true),
  ('a1000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   (now() at time zone 'Europe/Warsaw')::date - 7, 'lunch', 0, 'X', 'X', 8, true, true),
  ('a1000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   (now() at time zone 'Europe/Warsaw')::date - 7, 'lunch', 1, 'Y', 'Y', 7, false, false),
  -- User A: T lunch (chosen), T + 1 lunch (chosen).
  ('a2000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001',
   (now() at time zone 'Europe/Warsaw')::date, 'lunch', 0, 'X', 'X', 8, true, true),
  ('a2000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001',
   (now() at time zone 'Europe/Warsaw')::date + 1, 'lunch', 0, 'X', 'X', 8, true, true),
  -- User B: T lunch (chosen).
  ('b1000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002',
   (now() at time zone 'Europe/Warsaw')::date, 'lunch', 0, 'X', 'X', 8, true, true);

-- "Latest" fixtures (user C), fixed dates. Meal M, provider ntfy: 10-01, 10-08, then the annotated week
-- with M on 10-15 lunch and dinner and 10-16. Meal M on 10-10 of another provider. Meal K: annotated on
-- 10-13, rated only on 10-14 (later). Meal N: offered on 10-15, never rated.
insert into public.weekly_plans (id, user_id, provider, week_start, week_end, raw_payload) values
  ('30000000-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000003', 'ntfy', '2026-09-28', '2026-10-02', '{}'),
  ('30000000-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000003', 'ntfy', '2026-10-05', '2026-10-09', '{}'),
  ('30000000-0000-0000-0000-000000000003', 'cccccccc-0000-0000-0000-000000000003', 'other', '2026-10-10', '2026-10-11', '{}'),
  ('30000000-0000-0000-0000-000000000004', 'cccccccc-0000-0000-0000-000000000003', 'ntfy', '2026-10-12', '2026-10-16', '{}');

insert into public.plan_meal_options
  (id, plan_id, user_id, meal_date, meal_type, variant_index, provider_meal_id, name, score, is_recommended, is_chosen)
values
  ('c1000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000003',
   '2026-10-01', 'lunch', 0, 'M', 'M', 8, true, true),
  ('c2000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000003',
   '2026-10-08', 'lunch', 0, 'M', 'M', 8, true, true),
  ('c3000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 'cccccccc-0000-0000-0000-000000000003',
   '2026-10-10', 'lunch', 0, 'M', 'M', 8, true, true),
  ('c4000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000004', 'cccccccc-0000-0000-0000-000000000003',
   '2026-10-13', 'lunch', 0, 'K', 'K', 8, true, true),
  ('c4000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000004', 'cccccccc-0000-0000-0000-000000000003',
   '2026-10-14', 'lunch', 0, 'K', 'K', 8, true, true),
  ('c4000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000004', 'cccccccc-0000-0000-0000-000000000003',
   '2026-10-15', 'lunch', 0, 'M', 'M', 8, true, true),
  ('c4000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000004', 'cccccccc-0000-0000-0000-000000000003',
   '2026-10-15', 'lunch', 1, 'N', 'N', 7, false, false),
  ('c4000000-0000-0000-0000-000000000005', '30000000-0000-0000-0000-000000000004', 'cccccccc-0000-0000-0000-000000000003',
   '2026-10-15', 'dinner', 0, 'M', 'M', 8, true, true),
  ('c4000000-0000-0000-0000-000000000006', '30000000-0000-0000-0000-000000000004', 'cccccccc-0000-0000-0000-000000000003',
   '2026-10-16', 'lunch', 0, 'M', 'M', 8, true, true);

-- 10-01 M 😋, another provider's 10-10 M 😐, the annotated week's own 10-15 dinner M (same day) 🙂 and
-- 10-16 M (later) 🙂, 10-14 K 😋. 10-08 M starts unrated.
insert into public.meal_ratings (option_id, user_id, rating) values
  ('c1000000-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000003', 5),
  ('c3000000-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000003', 3),
  ('c4000000-0000-0000-0000-000000000005', 'cccccccc-0000-0000-0000-000000000003', 4),
  ('c4000000-0000-0000-0000-000000000006', 'cccccccc-0000-0000-0000-000000000003', 4),
  ('c4000000-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000003', 5);

-- Privileges.
select ok(
  not has_function_privilege('anon', 'public.rate_meal(uuid, smallint)', 'execute'),
  'anon cannot execute rate_meal'
);
select ok(
  has_function_privilege('authenticated', 'public.rate_meal(uuid, smallint)', 'execute'),
  'authenticated can execute rate_meal'
);
select ok(
  not has_function_privilege('anon', 'public.get_plan_ratings(uuid)', 'execute'),
  'anon cannot execute get_plan_ratings'
);
select ok(
  has_function_privilege('authenticated', 'public.get_plan_ratings(uuid)', 'execute'),
  'authenticated can execute get_plan_ratings'
);
-- The window lives only in rate_meal, so direct table writes must stay revoked.
select ok(
  not has_table_privilege('authenticated', 'public.meal_ratings', 'insert')
    and not has_table_privilege('authenticated', 'public.meal_ratings', 'update')
    and not has_table_privilege('authenticated', 'public.meal_ratings', 'delete'),
  'authenticated cannot write meal_ratings directly'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);

select throws_ok(
  $$ insert into public.meal_ratings (option_id, user_id, rating)
     values ('a2000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 5) $$,
  '42501', null,
  'a direct insert into meal_ratings is refused'
);

-- Window: both ends inclusive.
select is(
  public.rate_meal('a2000000-0000-0000-0000-000000000001', 5::smallint),
  5::smallint,
  'rating today''s chosen meal succeeds and returns the rating'
);
select is(
  public.rate_meal('a1000000-0000-0000-0000-000000000002', 2::smallint),
  2::smallint,
  'rating the chosen meal of today - 7 succeeds'
);
select throws_ok(
  $$ select public.rate_meal('a2000000-0000-0000-0000-000000000002', 4::smallint) $$,
  '55000', 'not_rateable',
  'rating a meal of today + 1 raises not_rateable'
);
select throws_ok(
  $$ select public.rate_meal('a1000000-0000-0000-0000-000000000001', 4::smallint) $$,
  '55000', 'not_rateable',
  'rating a meal of today - 8 raises not_rateable'
);
select throws_ok(
  $$ select public.rate_meal('a1000000-0000-0000-0000-000000000003', 4::smallint) $$,
  '55000', 'not_rateable',
  'rating an option that is not chosen raises not_rateable'
);
select throws_ok(
  $$ select public.rate_meal('a2000000-0000-0000-0000-000000000002', null) $$,
  '55000', 'not_rateable',
  'clearing outside the window raises not_rateable too'
);

-- Ownership.
select throws_ok(
  $$ select public.rate_meal('b1000000-0000-0000-0000-000000000001', 4::smallint) $$,
  'P0002', 'not_found',
  'rating another user''s option raises not_found'
);
select throws_ok(
  $$ select public.rate_meal('00000000-0000-0000-0000-000000000000', 4::smallint) $$,
  'P0002', 'not_found',
  'rating an unknown option raises not_found'
);

-- Scale.
select throws_ok(
  $$ select public.rate_meal('a2000000-0000-0000-0000-000000000001', 0::smallint) $$,
  '23514', null,
  'rating 0 fails the check constraint'
);
select throws_ok(
  $$ select public.rate_meal('a2000000-0000-0000-0000-000000000001', 6::smallint) $$,
  '23514', null,
  'rating 6 fails the check constraint'
);

-- Re-rating and clearing.
select is(
  public.rate_meal('a2000000-0000-0000-0000-000000000001', 3::smallint),
  3::smallint,
  're-rating returns the new rating'
);
select results_eq(
  $$ select option_id, rating, rated_at from public.meal_ratings order by option_id $$,
  $$ values
       ('a1000000-0000-0000-0000-000000000002'::uuid, 2::smallint, now()),
       ('a2000000-0000-0000-0000-000000000001'::uuid, 3::smallint, now()) $$,
  're-rating updates the one row of the option; the refused calls stored nothing'
);
select is(
  public.rate_meal('a1000000-0000-0000-0000-000000000002', null),
  null::smallint,
  'clearing returns null'
);
select results_eq(
  $$ select option_id from public.meal_ratings $$,
  $$ values ('a2000000-0000-0000-0000-000000000001'::uuid) $$,
  'clearing deletes the rating'
);
select lives_ok(
  $$ select public.rate_meal('a1000000-0000-0000-0000-000000000002', null) $$,
  'clearing a meal without a rating succeeds'
);

-- RLS: user B rates their own meal; each user sees only their own ratings.
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is(
  public.rate_meal('b1000000-0000-0000-0000-000000000001', 1::smallint),
  1::smallint,
  'user B rates their own meal'
);
select results_eq(
  $$ select option_id, user_id from public.meal_ratings $$,
  $$ values ('b1000000-0000-0000-0000-000000000001'::uuid, 'bbbbbbbb-0000-0000-0000-000000000002'::uuid) $$,
  'user B sees only their own rating'
);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq(
  $$ select option_id, user_id from public.meal_ratings $$,
  $$ values ('a2000000-0000-0000-0000-000000000001'::uuid, 'aaaaaaaa-0000-0000-0000-000000000001'::uuid) $$,
  'user A sees only their own rating'
);

-- get_plan_ratings ("latest" by meal day), as user C.
select set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-000000000003","role":"authenticated"}', true);

select results_eq(
  $$ select option_id, rating from public.get_plan_ratings('30000000-0000-0000-0000-000000000004') order by option_id $$,
  $$ values
       -- 10-14 K: 10-13 K was never rated.
       -- 10-15 M lunch: 10-08 M is unrated, so 10-01's 5 shows; the same day's dinner (4) and 10-16 (4) are
       -- ignored, and so is the other provider's 10-10 M (3).
       ('c4000000-0000-0000-0000-000000000003'::uuid, 5::smallint),
       -- 10-15 M dinner: the same day's lunch has no rating, so 10-01's 5.
       ('c4000000-0000-0000-0000-000000000005'::uuid, 5::smallint),
       -- 10-16 M: the most recent rated earlier day is 10-15 (dinner, 4).
       ('c4000000-0000-0000-0000-000000000006'::uuid, 4::smallint) $$,
  'an unrated later occurrence (10-08) does not hide an earlier rating; same-day, later and other-provider ratings are ignored'
);
select is_empty(
  $$ select 1 from public.get_plan_ratings('30000000-0000-0000-0000-000000000004')
      where option_id in ('c4000000-0000-0000-0000-000000000001', 'c4000000-0000-0000-0000-000000000002',
                          'c4000000-0000-0000-0000-000000000004') $$,
  'no row for a meal rated only later (10-13 K), never rated before (10-14 K) or never rated (N)'
);

-- 8 Oct rated 🤢 (fixture writes run as the table owner, outside the window).
reset role;
insert into public.meal_ratings (option_id, user_id, rating) values
  ('c2000000-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000003', 1);
set local role authenticated;

select results_eq(
  $$ select rating from public.get_plan_ratings('30000000-0000-0000-0000-000000000004')
      where option_id = 'c4000000-0000-0000-0000-000000000003' $$,
  $$ values (1::smallint) $$,
  'the rating of the most recent rated meal day (10-08) wins over an older one (10-01)'
);

-- 1 Oct re-rated 😐 later: 8 Oct is still the most recent rated meal day.
reset role;
update public.meal_ratings set rating = 3, rated_at = now() + interval '1 day'
 where option_id = 'c1000000-0000-0000-0000-000000000001';
set local role authenticated;

select results_eq(
  $$ select rating from public.get_plan_ratings('30000000-0000-0000-0000-000000000004')
      where option_id = 'c4000000-0000-0000-0000-000000000003' $$,
  $$ values (1::smallint) $$,
  're-rating an older occurrence does not override a newer occurrence''s rating'
);

-- 8 Oct cleared: the re-rated 1 Oct shows.
reset role;
delete from public.meal_ratings where option_id = 'c2000000-0000-0000-0000-000000000001';
set local role authenticated;

select results_eq(
  $$ select rating from public.get_plan_ratings('30000000-0000-0000-0000-000000000004')
      where option_id = 'c4000000-0000-0000-0000-000000000003' $$,
  $$ values (3::smallint) $$,
  'without a newer rating, the re-rated older occurrence shows its new rating'
);

-- Same meal rated twice on one day: the later rated_at wins.
reset role;
insert into public.meal_ratings (option_id, user_id, rating, rated_at) values
  ('c4000000-0000-0000-0000-000000000003', 'cccccccc-0000-0000-0000-000000000003', 2, now() + interval '1 hour');
set local role authenticated;

select results_eq(
  $$ select rating from public.get_plan_ratings('30000000-0000-0000-0000-000000000004')
      where option_id = 'c4000000-0000-0000-0000-000000000006' $$,
  $$ values (2::smallint) $$,
  'two ratings of the same meal on one day: the later rated_at wins'
);

-- Another user sees nothing for user C's plan.
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is_empty(
  $$ select 1 from public.get_plan_ratings('30000000-0000-0000-0000-000000000004') $$,
  'another user sees nothing for a plan that is not theirs'
);

reset role;

select results_eq(
  $$ select option_id, rating from public.meal_ratings where user_id <> 'cccccccc-0000-0000-0000-000000000003' order by option_id $$,
  $$ values
       ('a2000000-0000-0000-0000-000000000001'::uuid, 3::smallint),
       ('b1000000-0000-0000-0000-000000000001'::uuid, 1::smallint) $$,
  'stored ratings of users A and B as the table owner sees them'
);

select * from finish();
rollback;
