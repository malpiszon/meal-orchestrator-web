-- Test-plan risk #2 (testing-delivery-resend-integrity): "2xx means the week is stored", and any failure
-- part-way through the write answers non-2xx and leaves nothing half-written
-- (context/foundation/test-plan.md §2; context/changes/testing-delivery-resend-integrity/plan.md).
--
-- A changed re-send of a saved upcoming week makes ingest_weekly_plan update the plan row, delete its
-- option rows and only then insert the new ones. Each case below sends options that fail a
-- plan_meal_options constraint on that insert (a score of 11, a duplicate (date, type, variant_index), a
-- null name). The expected error names that constraint, which proves the call got past the update and
-- the delete; the snapshot then proves both were rolled back: the plan row, every option row (ids
-- included), the swapped choice and saved_at are exactly as before. The route answers such a failure
-- with 500 storage_failed (docs/mo-delivery-contract.md, Responses). Dates are relative to today in
-- Europe/Warsaw, and no date boundary is involved. Run with `npx supabase test db`.
begin;
select plan(16);

-- Day offsets are relative to today in Europe/Warsaw.
create function pg_temp.d(p_day int) returns date
language sql stable as $$ select (now() at time zone 'Europe/Warsaw')::date + p_day $$;

-- One option of the delivery payload.
create function pg_temp.o(p_day int, p_type text, p_variant int, p_meal text, p_score int, p_rec boolean)
returns jsonb
language sql stable as $$
  select jsonb_build_object('meal_date', pg_temp.d(p_day), 'meal_type', p_type, 'variant_index', p_variant,
    'provider_meal_id', p_meal, 'name', p_meal, 'score', p_score, 'is_recommended', p_rec)
$$;

-- A delivery of the week starting at p_day, as the delivery route makes it.
create function pg_temp.send(p_email text, p_day int, p_raw jsonb, variadic p_options jsonb[])
returns uuid
language sql volatile as $$
  select public.ingest_weekly_plan(p_email, 'ntfy', pg_temp.d(p_day), pg_temp.d(p_day + 4),
    p_raw->>'v', p_raw, to_jsonb(p_options))
$$;

create function pg_temp.pid() returns uuid
language sql stable as $$
  select id from public.weekly_plans
   where user_id = '70a70000-0000-0000-0000-000000000001' and week_start = pg_temp.d(8)
$$;

-- The plan row and its option rows, every column, as jsonb.
create function pg_temp.plan_row() returns setof jsonb
language sql stable as $$ select to_jsonb(p) from public.weekly_plans p where p.id = pg_temp.pid() $$;

create function pg_temp.option_rows() returns setof jsonb
language sql stable as $$
  select to_jsonb(o) from public.plan_meal_options o where o.plan_id = pg_temp.pid() order by o.id
$$;

create function pg_temp.chosen() returns table (meal_type text, provider_meal_id text, option_id uuid)
language sql stable as $$
  select meal_type, provider_meal_id, id from public.plan_meal_options
   where plan_id = pg_temp.pid() and is_chosen order by meal_date, meal_type
$$;

create temp table snap_plan (j jsonb);
create temp table snap_options (j jsonb);
create temp table snap_chosen (meal_type text, provider_meal_id text, option_id uuid);

insert into auth.users (id, email) values
  ('70a70000-0000-0000-0000-000000000001', 'atomic-a@test.local');

-- Fixture: an upcoming week (day 8), first delivery, then saved by swapping day-8 lunch from X to Y.
set local role service_role;
select pg_temp.send('atomic-a@test.local', 8, '{"week":"atomic","v":"1"}',
  pg_temp.o(8, 'lunch', 0, 'X', 8, true), pg_temp.o(8, 'lunch', 1, 'Y', 7, false),
  pg_temp.o(8, 'dinner', 0, 'Z', 8, true), pg_temp.o(8, 'dinner', 1, 'W', 7, false));
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"70a70000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.choose_plan_option(
  (select id from public.plan_meal_options
    where plan_id = pg_temp.pid() and meal_type = 'lunch' and provider_meal_id = 'Y'));
reset role;

-- Fixed timestamps, so a write by the failed re-send (now()) would show.
update public.weekly_plans set received_at = '2026-01-01 00:00+00', saved_at = '2026-01-02 00:00+00'
 where id = pg_temp.pid();

insert into snap_plan select * from pg_temp.plan_row();
insert into snap_options select * from pg_temp.option_rows();
insert into snap_chosen select * from pg_temp.chosen();

select results_eq(
  $$ select meal_type, provider_meal_id from snap_chosen order by meal_type $$,
  $$ values ('dinner', 'Z'), ('lunch', 'Y') $$,
  'fixture: the week is saved with the swapped Y at lunch and Z at dinner'
);

-- Each re-send changes the body (run_id and raw), so it is neither identical nor, for an upcoming
-- week, refused: it reaches the update and the delete before its options fail the insert.

-- Case 1: a score of 11 fails plan_meal_options_score_check (score between 1 and 10).
set local role service_role;
select throws_ok(
  $$ select pg_temp.send('atomic-a@test.local', 8, '{"week":"atomic","v":"2"}',
       pg_temp.o(8, 'lunch', 0, 'X', 9, true), pg_temp.o(8, 'lunch', 1, 'Y', 7, false),
       pg_temp.o(8, 'dinner', 0, 'Z', 8, true), pg_temp.o(8, 'dinner', 1, 'W', 11, false)) $$,
  '23514',
  'new row for relation "plan_meal_options" violates check constraint "plan_meal_options_score_check"',
  'score 11: the re-send fails on the option insert'
);
reset role;

select results_eq(
  $$ select * from pg_temp.plan_row() $$, $$ select j from snap_plan $$,
  'score 11: the plan row is unchanged'
);
select results_eq(
  $$ select * from pg_temp.option_rows() $$, $$ select j from snap_options order by j->>'id' $$,
  'score 11: every option row is unchanged'
);
select results_eq(
  $$ select * from pg_temp.chosen() $$, $$ select * from snap_chosen order by meal_type $$,
  'score 11: the swapped Y and Z stay the chosen options'
);
select is(
  (select saved_at from public.weekly_plans where id = pg_temp.pid()),
  '2026-01-02 00:00+00'::timestamptz,
  'score 11: saved_at is unchanged'
);

-- Case 2: two options of day-8 dinner share variant_index 1.
set local role service_role;
select throws_ok(
  $$ select pg_temp.send('atomic-a@test.local', 8, '{"week":"atomic","v":"3"}',
       pg_temp.o(8, 'lunch', 0, 'X', 9, true), pg_temp.o(8, 'lunch', 1, 'Y', 7, false),
       pg_temp.o(8, 'dinner', 0, 'Z', 8, true), pg_temp.o(8, 'dinner', 1, 'W', 7, false),
       pg_temp.o(8, 'dinner', 1, 'V', 6, false)) $$,
  '23505',
  'duplicate key value violates unique constraint "plan_meal_options_plan_id_meal_date_meal_type_variant_index_key"',
  'duplicate variant: the re-send fails on the option insert'
);
reset role;

select results_eq(
  $$ select * from pg_temp.plan_row() $$, $$ select j from snap_plan $$,
  'duplicate variant: the plan row is unchanged'
);
select results_eq(
  $$ select * from pg_temp.option_rows() $$, $$ select j from snap_options order by j->>'id' $$,
  'duplicate variant: every option row is unchanged'
);
select results_eq(
  $$ select * from pg_temp.chosen() $$, $$ select * from snap_chosen order by meal_type $$,
  'duplicate variant: the swapped Y and Z stay the chosen options'
);
select is(
  (select saved_at from public.weekly_plans where id = pg_temp.pid()),
  '2026-01-02 00:00+00'::timestamptz,
  'duplicate variant: saved_at is unchanged'
);

-- Case 3: an option without a name.
set local role service_role;
select throws_ok(
  $$ select pg_temp.send('atomic-a@test.local', 8, '{"week":"atomic","v":"4"}',
       pg_temp.o(8, 'lunch', 0, 'X', 9, true), pg_temp.o(8, 'lunch', 1, 'Y', 7, false),
       pg_temp.o(8, 'dinner', 0, 'Z', 8, true),
       pg_temp.o(8, 'dinner', 1, 'W', 7, false) || '{"name":null}') $$,
  '23502',
  'null value in column "name" of relation "plan_meal_options" violates not-null constraint',
  'null name: the re-send fails on the option insert'
);
reset role;

select results_eq(
  $$ select * from pg_temp.plan_row() $$, $$ select j from snap_plan $$,
  'null name: the plan row is unchanged'
);
select results_eq(
  $$ select * from pg_temp.option_rows() $$, $$ select j from snap_options order by j->>'id' $$,
  'null name: every option row is unchanged'
);
select results_eq(
  $$ select * from pg_temp.chosen() $$, $$ select * from snap_chosen order by meal_type $$,
  'null name: the swapped Y and Z stay the chosen options'
);
select is(
  (select saved_at from public.weekly_plans where id = pg_temp.pid()),
  '2026-01-02 00:00+00'::timestamptz,
  'null name: saved_at is unchanged'
);

select * from finish();
rollback;
