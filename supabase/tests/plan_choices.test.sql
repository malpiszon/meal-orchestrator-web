-- S-03: pins the write rules of choose_plan_option and confirm_plan (ownership, one chosen option per
-- slot, the Europe/Warsaw cut-off) and ingest's reset of choices on re-delivery
-- (see context/changes/swap-and-save-plan/plan.md). Dates are relative to today in Europe/Warsaw,
-- so the test never ages. Run with `npx supabase test db`.
begin;
select plan(29);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'choices-a@test.local'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'choices-b@test.local');

-- 10..01: user A, starts tomorrow (editable). 10..02: user A, starts today (locked).
-- 20..01: user B, starts tomorrow.
insert into public.weekly_plans (id, user_id, provider, week_start, week_end, raw_payload) values
  ('10000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'ntfy',
   (now() at time zone 'Europe/Warsaw')::date + 1, (now() at time zone 'Europe/Warsaw')::date + 5, '{}'),
  ('10000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'ntfy',
   (now() at time zone 'Europe/Warsaw')::date, (now() at time zone 'Europe/Warsaw')::date + 4, '{}'),
  ('20000000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'ntfy',
   (now() at time zone 'Europe/Warsaw')::date + 1, (now() at time zone 'Europe/Warsaw')::date + 5, '{}');

insert into public.plan_meal_options
  (id, plan_id, user_id, meal_date, meal_type, variant_index, provider_meal_id, name, score, is_recommended, is_chosen)
values
  -- User A, tomorrow's plan: day 1 lunch, day 1 dinner, day 2 lunch.
  ('a1000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   (now() at time zone 'Europe/Warsaw')::date + 1, 'lunch', 0, 'X', 'X', 8, true, true),
  ('a1000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   (now() at time zone 'Europe/Warsaw')::date + 1, 'lunch', 1, 'Y', 'Y', 7, false, false),
  ('a1000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   (now() at time zone 'Europe/Warsaw')::date + 1, 'dinner', 0, 'Z', 'Z', 8, true, true),
  ('a1000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   (now() at time zone 'Europe/Warsaw')::date + 1, 'dinner', 1, 'W', 'W', 7, false, false),
  ('a1000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   (now() at time zone 'Europe/Warsaw')::date + 2, 'lunch', 0, 'X', 'X', 8, true, true),
  ('a1000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   (now() at time zone 'Europe/Warsaw')::date + 2, 'lunch', 1, 'Y', 'Y', 7, false, false),
  -- User A, the plan starting today.
  ('a2000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001',
   (now() at time zone 'Europe/Warsaw')::date, 'lunch', 0, 'X', 'X', 8, true, true),
  ('a2000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001',
   (now() at time zone 'Europe/Warsaw')::date, 'lunch', 1, 'Y', 'Y', 7, false, false),
  -- User B, tomorrow's plan.
  ('b1000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002',
   (now() at time zone 'Europe/Warsaw')::date + 1, 'lunch', 0, 'X', 'X', 8, true, true),
  ('b1000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002',
   (now() at time zone 'Europe/Warsaw')::date + 1, 'lunch', 1, 'Y', 'Y', 7, false, false);

-- Privileges.
select ok(
  not has_function_privilege('anon', 'public.choose_plan_option(uuid)', 'execute'),
  'anon cannot execute choose_plan_option'
);
select ok(
  has_function_privilege('authenticated', 'public.choose_plan_option(uuid)', 'execute'),
  'authenticated can execute choose_plan_option'
);
select ok(
  not has_function_privilege('anon', 'public.confirm_plan(uuid)', 'execute'),
  'anon cannot execute confirm_plan'
);
select ok(
  has_function_privilege('authenticated', 'public.confirm_plan(uuid)', 'execute'),
  'authenticated can execute confirm_plan'
);
-- The cut-off lives only in the two functions, so direct table writes must stay revoked.
select ok(
  not has_table_privilege('authenticated', 'public.plan_meal_options', 'update'),
  'authenticated cannot update plan_meal_options directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.weekly_plans', 'update'),
  'authenticated cannot update weekly_plans directly'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);

-- Swap: day 1 lunch moves from X to Y.
select is(
  public.choose_plan_option('a1000000-0000-0000-0000-000000000002'),
  now(),
  'choose_plan_option returns the new saved_at'
);
select results_eq(
  $$ select id from public.plan_meal_options where plan_id = '10000000-0000-0000-0000-000000000001' and is_chosen order by id $$,
  $$ values
       -- day 1 lunch: Y now; day 1 dinner and day 2 lunch untouched.
       ('a1000000-0000-0000-0000-000000000002'::uuid),
       ('a1000000-0000-0000-0000-000000000003'::uuid),
       ('a1000000-0000-0000-0000-000000000005'::uuid) $$,
  'the choice moves within its slot only'
);
select is(
  (select count(*) from public.plan_meal_options
    where plan_id = '10000000-0000-0000-0000-000000000001'
      and meal_date = (now() at time zone 'Europe/Warsaw')::date + 1 and meal_type = 'lunch' and is_chosen),
  1::bigint,
  'exactly one chosen option in the slot'
);
select is(
  (select saved_at from public.weekly_plans where id = '10000000-0000-0000-0000-000000000001'),
  now(),
  'choose_plan_option sets saved_at'
);

-- Back to MO's recommendation.
select lives_ok(
  $$ select public.choose_plan_option('a1000000-0000-0000-0000-000000000001') $$,
  'choosing the recommended option again succeeds'
);
select results_eq(
  $$ select id from public.plan_meal_options where plan_id = '10000000-0000-0000-0000-000000000001' and is_chosen order by id $$,
  $$ values
       ('a1000000-0000-0000-0000-000000000001'::uuid),
       ('a1000000-0000-0000-0000-000000000003'::uuid),
       ('a1000000-0000-0000-0000-000000000005'::uuid) $$,
  'the choice moves back to the recommended option'
);

-- confirm_plan on a never-saved plan (saved_at cleared as the table owner first).
reset role;
update public.weekly_plans set saved_at = null where id = '10000000-0000-0000-0000-000000000001';
set local role authenticated;

select is(
  public.confirm_plan('10000000-0000-0000-0000-000000000001'),
  now(),
  'confirm_plan returns the new saved_at'
);
select is(
  (select saved_at from public.weekly_plans where id = '10000000-0000-0000-0000-000000000001'),
  now(),
  'confirm_plan sets saved_at'
);
select results_eq(
  $$ select id from public.plan_meal_options where plan_id = '10000000-0000-0000-0000-000000000001' and is_chosen order by id $$,
  $$ values
       ('a1000000-0000-0000-0000-000000000001'::uuid),
       ('a1000000-0000-0000-0000-000000000003'::uuid),
       ('a1000000-0000-0000-0000-000000000005'::uuid) $$,
  'confirm_plan changes no choice'
);

-- Cut-off: the plan starting today is locked.
select throws_ok(
  $$ select public.choose_plan_option('a2000000-0000-0000-0000-000000000002') $$,
  '55000', 'plan_locked',
  'choose_plan_option on a plan starting today raises plan_locked'
);
select throws_ok(
  $$ select public.confirm_plan('10000000-0000-0000-0000-000000000002') $$,
  '55000', 'plan_locked',
  'confirm_plan on a plan starting today raises plan_locked'
);

-- Ownership: user B's option and plan, and an unknown option, are not found.
select throws_ok(
  $$ select public.choose_plan_option('b1000000-0000-0000-0000-000000000002') $$,
  'P0002', 'not_found',
  'choose_plan_option on another user''s option raises not_found'
);
select throws_ok(
  $$ select public.confirm_plan('20000000-0000-0000-0000-000000000001') $$,
  'P0002', 'not_found',
  'confirm_plan on another user''s plan raises not_found'
);
select throws_ok(
  $$ select public.choose_plan_option('00000000-0000-0000-0000-000000000000') $$,
  'P0002', 'not_found',
  'choose_plan_option on an unknown option raises not_found'
);

reset role;

select results_eq(
  $$ select id, is_chosen from public.plan_meal_options where plan_id = '10000000-0000-0000-0000-000000000002' order by id $$,
  $$ values ('a2000000-0000-0000-0000-000000000001'::uuid, true), ('a2000000-0000-0000-0000-000000000002'::uuid, false) $$,
  'the locked plan''s choices are unchanged'
);
select results_eq(
  $$ select id, is_chosen from public.plan_meal_options where plan_id = '20000000-0000-0000-0000-000000000001' order by id $$,
  $$ values ('b1000000-0000-0000-0000-000000000001'::uuid, true), ('b1000000-0000-0000-0000-000000000002'::uuid, false) $$,
  'user B''s choices are unchanged'
);
select ok(
  (select saved_at is null from public.weekly_plans where id = '20000000-0000-0000-0000-000000000001')
    and (select saved_at is null from public.weekly_plans where id = '10000000-0000-0000-0000-000000000002'),
  'user B''s plan and the locked plan stay unsaved'
);

-- Re-delivery of tomorrow's week after a swap: choices and saved_at reset.
set local role authenticated;
select lives_ok(
  $$ select public.choose_plan_option('a1000000-0000-0000-0000-000000000002') $$,
  'user A swaps day 1 lunch before the re-delivery'
);
reset role;

set local role service_role;
select is(
  public.ingest_weekly_plan(
    'choices-a@test.local', 'ntfy',
    (now() at time zone 'Europe/Warsaw')::date + 1, (now() at time zone 'Europe/Warsaw')::date + 5,
    'run-2', '{}'::jsonb,
    jsonb_build_array(
      jsonb_build_object('meal_date', (now() at time zone 'Europe/Warsaw')::date + 1, 'meal_type', 'lunch',
        'variant_index', 0, 'provider_meal_id', 'X', 'name', 'X', 'score', 6, 'is_recommended', false),
      jsonb_build_object('meal_date', (now() at time zone 'Europe/Warsaw')::date + 1, 'meal_type', 'lunch',
        'variant_index', 1, 'provider_meal_id', 'Y', 'name', 'Y', 'score', 9, 'is_recommended', true),
      jsonb_build_object('meal_date', (now() at time zone 'Europe/Warsaw')::date + 1, 'meal_type', 'dinner',
        'variant_index', 0, 'provider_meal_id', 'Z', 'name', 'Z', 'score', 8, 'is_recommended', true)
    )
  ),
  '10000000-0000-0000-0000-000000000001'::uuid,
  're-delivery keeps the plan row'
);
reset role;

select ok(
  (select saved_at is null from public.weekly_plans where id = '10000000-0000-0000-0000-000000000001'),
  're-delivery resets saved_at to null'
);
select results_eq(
  $$ select provider_meal_id, meal_type, is_chosen from public.plan_meal_options
      where plan_id = '10000000-0000-0000-0000-000000000001' order by meal_type, variant_index $$,
  $$ values ('Z', 'dinner', true), ('X', 'lunch', false), ('Y', 'lunch', true) $$,
  're-delivery resets is_chosen to is_recommended'
);

-- First delivery of a new week.
set local role service_role;
select lives_ok(
  $$ select public.ingest_weekly_plan(
       'choices-a@test.local', 'ntfy',
       (now() at time zone 'Europe/Warsaw')::date + 8, (now() at time zone 'Europe/Warsaw')::date + 12,
       'run-3', '{}'::jsonb,
       jsonb_build_array(
         jsonb_build_object('meal_date', (now() at time zone 'Europe/Warsaw')::date + 8, 'meal_type', 'lunch',
           'variant_index', 0, 'provider_meal_id', 'X', 'name', 'X', 'score', 9, 'is_recommended', true),
         jsonb_build_object('meal_date', (now() at time zone 'Europe/Warsaw')::date + 8, 'meal_type', 'lunch',
           'variant_index', 1, 'provider_meal_id', 'Y', 'name', 'Y', 'score', 6, 'is_recommended', false)
       )
     ) $$,
  'a first delivery of a new week succeeds'
);
reset role;

select results_eq(
  $$ select o.provider_meal_id, o.is_chosen, p.saved_at is null
       from public.plan_meal_options o
       join public.weekly_plans p on p.id = o.plan_id
      where p.user_id = 'aaaaaaaa-0000-0000-0000-000000000001'
        and p.week_start = (now() at time zone 'Europe/Warsaw')::date + 8
      order by o.variant_index $$,
  $$ values ('X', true, true), ('Y', false, true) $$,
  'a first delivery sets is_chosen = is_recommended and leaves the plan unsaved'
);

select * from finish();
rollback;
