-- Test-plan Phase 2 (testing-migration-date-rules): pins every SQL date rule at its boundary days, with
-- today pinned to 2026-03-30 (T), a date the real one never matches. A function that derives today
-- without private.warsaw_today() therefore fails here on every run, not only near Warsaw midnight.
-- The expected values come from the PRD and docs/api.md, not from the functions:
-- - cut-off (PRD US-01 AC4; docs/api.md "Cut-off"): a plan can be changed while its week_start is after
--   today, so a plan starting T+1 is editable and one starting T or T-1 is refused with plan_locked;
-- - rating window (PRD US-08, FR-013; docs/api.md "Ratings"): today minus 7 days to today, both included,
--   so meals dated T and T-7 are rateable and T+1 and T-8 are refused with not_rateable;
-- - week_started (PRD US-07, FR-017, FR-018; docs/api.md "MO delivery"): a changed re-send of a week whose
--   Monday is today or earlier is refused, a changed re-send of an upcoming week replaces it, and a first
--   delivery of a started week is stored;
-- - late-rating re-pick (docs/api.md "Ratings"): rating a meal re-picks the unsaved plans that have not
--   started, so an unsaved plan starting T+1 is re-picked and one starting T is not.
-- Fixture dates are fixed: pg_temp.d(n) is T + n days. Run with `npx supabase test db`.
begin;
select plan(24);

-- Pin today, as postgres (the helper's owner), before any role switch. Rolled back with the file.
create or replace function private.warsaw_today()
returns date
language sql
stable
set search_path = ''
as $$
  select date '2026-03-30';
$$;

-- The pinned today, T, plus p_day days.
create function pg_temp.d(p_day int) returns date
language sql immutable as $$ select date '2026-03-30' + p_day $$;

-- The rating window in days: PRD FR-013 calls 7 "a best-guess value, to be tuned".
create function pg_temp.rating_window() returns int
language sql immutable as $$ select 7 $$;

-- One option of a delivery payload.
create function pg_temp.o(p_day int, p_variant int, p_meal text, p_score int, p_rec boolean)
returns jsonb
language sql immutable as $$
  select jsonb_build_object('meal_date', pg_temp.d(p_day), 'meal_type', 'lunch', 'variant_index', p_variant,
    'provider_meal_id', p_meal, 'name', p_meal, 'score', p_score, 'is_recommended', p_rec)
$$;

-- A delivery for user C of the week starting at p_day, as the delivery route makes it.
create function pg_temp.send(p_day int, p_raw jsonb, variadic p_options jsonb[])
returns uuid
language sql volatile as $$
  select public.ingest_weekly_plan('boundary-c@test.local', 'ntfy', pg_temp.d(p_day), pg_temp.d(p_day + 4),
    p_raw->>'v', p_raw, to_jsonb(p_options))
$$;

-- User C's plan for the week starting at p_day.
create function pg_temp.pid(p_day int) returns uuid
language sql stable as $$
  select id from public.weekly_plans
   where user_id = 'ffffffff-0000-0000-0000-000000000006' and week_start = pg_temp.d(p_day)
$$;

-- Every stored row of user C's plans starting at the given days.
create function pg_temp.state(p_days int[])
returns table (
  plan_id uuid, week_start date, raw_payload jsonb, received_at timestamptz, saved_at timestamptz,
  option_id uuid, provider_meal_id text, score smallint, is_recommended boolean, is_chosen boolean
)
language sql stable as $$
  select p.id, p.week_start, p.raw_payload, p.received_at, p.saved_at,
         o.id, o.provider_meal_id, o.score, o.is_recommended, o.is_chosen
    from public.weekly_plans p
    left join public.plan_meal_options o on o.plan_id = p.id
   where p.user_id = 'ffffffff-0000-0000-0000-000000000006'
     and p.week_start in (select pg_temp.d(day) from unnest(p_days) as day)
   order by p.week_start, o.variant_index
$$;

-- The chosen dishes of a plan.
create function pg_temp.chosen(p_plan uuid) returns setof text
language sql stable as $$
  select provider_meal_id from public.plan_meal_options where plan_id = p_plan and is_chosen
   order by meal_date, meal_type
$$;

create temp table snap as select * from pg_temp.state(array[]::int[]) with no data;

-- A: cut-off. B: rating window. C: deliveries. D: late-rating re-pick.
insert into auth.users (id, email) values
  ('dddddddd-0000-0000-0000-000000000004', 'boundary-a@test.local'),
  ('eeeeeeee-0000-0000-0000-000000000005', 'boundary-b@test.local'),
  ('ffffffff-0000-0000-0000-000000000006', 'boundary-c@test.local'),
  ('abababab-0000-0000-0000-000000000007', 'boundary-d@test.local');

-- 40..01-03: A, starting T+1, T (unsaved) and T-1 (saved). 50..01: B, starting T-8 (meals T-8 and T-7).
-- 50..02: B, starting T (meals T and T+1). 60..01: D, starting T-7 (LATE eaten on T-2). 60..02 and
-- 60..03: D, unsaved, starting T and T+1, both preselecting LATE over ALT.
insert into public.weekly_plans (id, user_id, provider, week_start, week_end, raw_payload, saved_at) values
  ('40000000-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000004', 'ntfy',
   pg_temp.d(1), pg_temp.d(5), '{}', null),
  ('40000000-0000-0000-0000-000000000002', 'dddddddd-0000-0000-0000-000000000004', 'ntfy',
   pg_temp.d(0), pg_temp.d(4), '{}', null),
  ('40000000-0000-0000-0000-000000000003', 'dddddddd-0000-0000-0000-000000000004', 'ntfy',
   pg_temp.d(-1), pg_temp.d(3), '{}', '2026-03-20 10:00+00'),
  ('50000000-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000005', 'ntfy',
   pg_temp.d(-pg_temp.rating_window() - 1), pg_temp.d(-pg_temp.rating_window() + 3), '{}', null),
  ('50000000-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000005', 'ntfy',
   pg_temp.d(0), pg_temp.d(4), '{}', null),
  ('60000000-0000-0000-0000-000000000001', 'abababab-0000-0000-0000-000000000007', 'ntfy',
   pg_temp.d(-7), pg_temp.d(-3), '{}', '2026-03-22 10:00+00'),
  ('60000000-0000-0000-0000-000000000002', 'abababab-0000-0000-0000-000000000007', 'ntfy',
   pg_temp.d(0), pg_temp.d(4), '{}', null),
  ('60000000-0000-0000-0000-000000000003', 'abababab-0000-0000-0000-000000000007', 'ntfy',
   pg_temp.d(1), pg_temp.d(5), '{}', null);

insert into public.plan_meal_options
  (id, plan_id, user_id, meal_date, meal_type, variant_index, provider_meal_id, name, score, is_recommended, is_chosen)
values
  ('d1000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000004',
   pg_temp.d(1), 'lunch', 0, 'X', 'X', 8, true, true),
  ('d1000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000004',
   pg_temp.d(1), 'lunch', 1, 'Y', 'Y', 7, false, false),
  ('d2000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000002', 'dddddddd-0000-0000-0000-000000000004',
   pg_temp.d(0), 'lunch', 0, 'X', 'X', 8, true, true),
  ('d2000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', 'dddddddd-0000-0000-0000-000000000004',
   pg_temp.d(0), 'lunch', 1, 'Y', 'Y', 7, false, false),
  ('d3000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000003', 'dddddddd-0000-0000-0000-000000000004',
   pg_temp.d(-1), 'lunch', 0, 'X', 'X', 8, true, true),
  ('d3000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000003', 'dddddddd-0000-0000-0000-000000000004',
   pg_temp.d(-1), 'lunch', 1, 'Y', 'Y', 7, false, false),
  -- B: every rated meal is the chosen option of its slot, so only its date decides.
  ('e1000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000005',
   pg_temp.d(-pg_temp.rating_window() - 1), 'lunch', 0, 'M8', 'M8', 8, true, true),
  ('e1000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000005',
   pg_temp.d(-pg_temp.rating_window()), 'lunch', 0, 'M7', 'M7', 8, true, true),
  ('e2000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000005',
   pg_temp.d(0), 'lunch', 0, 'M0', 'M0', 8, true, true),
  ('e2000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000005',
   pg_temp.d(1), 'lunch', 0, 'M1', 'M1', 8, true, true),
  ('f1000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 'abababab-0000-0000-0000-000000000007',
   pg_temp.d(-2), 'lunch', 0, 'LATE', 'LATE', 9, true, true),
  ('f2000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000002', 'abababab-0000-0000-0000-000000000007',
   pg_temp.d(0), 'lunch', 0, 'LATE', 'LATE', 9, true, true),
  ('f2000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000002', 'abababab-0000-0000-0000-000000000007',
   pg_temp.d(0), 'lunch', 1, 'ALT', 'ALT', 5, false, false),
  ('f3000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000003', 'abababab-0000-0000-0000-000000000007',
   pg_temp.d(1), 'lunch', 0, 'LATE', 'LATE', 9, true, true),
  ('f3000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000003', 'abababab-0000-0000-0000-000000000007',
   pg_temp.d(1), 'lunch', 1, 'ALT', 'ALT', 5, false, false);

-- Rating window (user B). The first case proves the pin: under the real date, a meal dated 2026-03-30 is
-- months outside the window.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"eeeeeeee-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is(
  public.rate_meal('e2000000-0000-0000-0000-000000000001', 5::smallint),
  5::smallint,
  'pinned today: rating the meal dated T (2026-03-30) succeeds'
);
select is(
  public.rate_meal('e1000000-0000-0000-0000-000000000002', 2::smallint),
  2::smallint,
  'rating window: the meal dated T minus the window (T-7) succeeds'
);
select throws_ok(
  $$ select public.rate_meal('e2000000-0000-0000-0000-000000000002', 4::smallint) $$,
  '55000', 'not_rateable',
  'rating window: the meal dated T+1 raises not_rateable'
);
select throws_ok(
  $$ select public.rate_meal('e1000000-0000-0000-0000-000000000001', 4::smallint) $$,
  '55000', 'not_rateable',
  'rating window: the meal dated a day before the window (T-8) raises not_rateable'
);
reset role;
select results_eq(
  $$ select option_id, rating::int from public.meal_ratings
      where user_id = 'eeeeeeee-0000-0000-0000-000000000005' order by option_id $$,
  $$ values ('e1000000-0000-0000-0000-000000000002'::uuid, 2), ('e2000000-0000-0000-0000-000000000001'::uuid, 5) $$,
  'rating window: the T and T-7 ratings are stored'
);
select is_empty(
  $$ select 1 from public.meal_ratings
      where option_id in ('e2000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001') $$,
  'rating window: the refused T+1 and T-8 ratings leave no row'
);

-- Cut-off (user A, the owner).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"dddddddd-0000-0000-0000-000000000004","role":"authenticated"}', true);
select isnt(
  public.choose_plan_option('d1000000-0000-0000-0000-000000000002'),
  null::timestamptz,
  'cut-off: choose_plan_option on a plan starting T+1 succeeds'
);
select results_eq(
  $$ select * from pg_temp.chosen('40000000-0000-0000-0000-000000000001') $$,
  $$ values ('Y') $$,
  'cut-off: the plan starting T+1 now has Y chosen'
);
select isnt(
  public.confirm_plan('40000000-0000-0000-0000-000000000001'),
  null::timestamptz,
  'cut-off: confirm_plan on a plan starting T+1 succeeds'
);
select throws_ok(
  $$ select public.choose_plan_option('d2000000-0000-0000-0000-000000000002') $$,
  '55000', 'plan_locked',
  'cut-off: choose_plan_option on a plan starting T raises plan_locked'
);
select throws_ok(
  $$ select public.confirm_plan('40000000-0000-0000-0000-000000000002') $$,
  '55000', 'plan_locked',
  'cut-off: confirm_plan on a plan starting T raises plan_locked'
);
select throws_ok(
  $$ select public.choose_plan_option('d3000000-0000-0000-0000-000000000002') $$,
  '55000', 'plan_locked',
  'cut-off: choose_plan_option on a plan starting T-1 raises plan_locked'
);
select throws_ok(
  $$ select public.confirm_plan('40000000-0000-0000-0000-000000000003') $$,
  '55000', 'plan_locked',
  'cut-off: confirm_plan on a plan starting T-1 raises plan_locked'
);
reset role;
select results_eq(
  $$ select p.id, p.saved_at, o.provider_meal_id, o.is_chosen
       from public.weekly_plans p
       join public.plan_meal_options o on o.plan_id = p.id
      where p.id in ('40000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000003')
      order by p.week_start, o.variant_index $$,
  $$ values
       ('40000000-0000-0000-0000-000000000003'::uuid, '2026-03-20 10:00+00'::timestamptz, 'X', true),
       ('40000000-0000-0000-0000-000000000003'::uuid, '2026-03-20 10:00+00'::timestamptz, 'Y', false),
       ('40000000-0000-0000-0000-000000000002'::uuid, null::timestamptz, 'X', true),
       ('40000000-0000-0000-0000-000000000002'::uuid, null::timestamptz, 'Y', false) $$,
  'cut-off: the locked plans starting T and T-1 keep their choices and saved_at'
);

-- week_started (user C, through ingest_weekly_plan as the delivery route calls it). First deliveries of
-- the weeks starting T+1 and T, then of the week starting T-1, which has started.
set local role service_role;
select pg_temp.send(1, '{"week":"t+1","v":"1"}', pg_temp.o(1, 0, 'X', 8, true), pg_temp.o(1, 1, 'Y', 7, false));
select pg_temp.send(0, '{"week":"t","v":"1"}', pg_temp.o(0, 0, 'X', 8, true), pg_temp.o(0, 1, 'Y', 7, false));
select isnt(
  pg_temp.send(-1, '{"week":"t-1","v":"1"}', pg_temp.o(-1, 0, 'X', 8, true), pg_temp.o(-1, 1, 'Y', 7, false)),
  null::uuid,
  'week_started: a first delivery of the week starting T-1 returns a plan_id'
);
reset role;
select results_eq(
  $$ select provider_meal_id, is_chosen from pg_temp.state(array[-1]) $$,
  $$ values ('X', true), ('Y', false) $$,
  'week_started: the first delivery of the week starting T-1 is stored with its options'
);

-- A received_at in the past, so a write by a re-send (now()) would be visible.
update public.weekly_plans set received_at = '2026-01-01 00:00+00'
 where user_id = 'ffffffff-0000-0000-0000-000000000006';
insert into snap select * from pg_temp.state(array[0, -1]);

set local role service_role;
select is(
  pg_temp.send(1, '{"week":"t+1","v":"2"}', pg_temp.o(1, 0, 'X', 6, false), pg_temp.o(1, 1, 'Y', 9, true)),
  pg_temp.pid(1),
  'week_started: a changed re-send of the week starting T+1 returns its plan_id'
);
reset role;
select results_eq(
  $$ select raw_payload->>'v', provider_meal_id, score::int, is_chosen from pg_temp.state(array[1]) $$,
  $$ values ('2', 'X', 6, false), ('2', 'Y', 9, true) $$,
  'week_started: the changed re-send replaces the week starting T+1'
);

set local role service_role;
select throws_ok(
  $$ select pg_temp.send(0, '{"week":"t","v":"2"}', pg_temp.o(0, 0, 'X', 6, false), pg_temp.o(0, 1, 'Y', 9, true)) $$,
  '55000', 'week_started',
  'week_started: a changed re-send of the week starting T raises week_started'
);
select throws_ok(
  $$ select pg_temp.send(-1, '{"week":"t-1","v":"2"}', pg_temp.o(-1, 0, 'X', 6, false), pg_temp.o(-1, 1, 'Y', 9, true)) $$,
  '55000', 'week_started',
  'week_started: a changed re-send of the week starting T-1 raises week_started'
);
reset role;
select results_eq(
  $$ select * from pg_temp.state(array[0, -1]) order by option_id $$,
  $$ select * from snap order by option_id $$,
  'week_started: the refused re-sends leave the weeks starting T and T-1 unchanged'
);

-- Late-rating re-pick (user D): LATE, eaten on T-2, is rated 1/5.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"abababab-0000-0000-0000-000000000007","role":"authenticated"}', true);
select is(
  public.rate_meal('f1000000-0000-0000-0000-000000000001', 1::smallint),
  1::smallint,
  're-pick: rating LATE 1/5 succeeds'
);
reset role;
select results_eq(
  $$ select * from pg_temp.chosen('60000000-0000-0000-0000-000000000003') $$,
  $$ values ('ALT') $$,
  're-pick: the unsaved plan starting T+1 is re-picked (ALT instead of LATE)'
);
select results_eq(
  $$ select * from pg_temp.chosen('60000000-0000-0000-0000-000000000002') $$,
  $$ values ('LATE') $$,
  're-pick: the unsaved plan starting T keeps LATE'
);

select * from finish();
rollback;
