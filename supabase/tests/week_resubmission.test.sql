-- S-06: pins what ingest_weekly_plan does with a week MO delivers again (FR-017, FR-018; see
-- context/changes/week-resubmission-replace/plan.md): an identical re-send is a no-op, a changed
-- re-send of a started week is refused, a changed re-send of a saved upcoming week keeps the user's
-- dishes, and no re-send touches another week, another user or the history. Dates are relative to
-- today in Europe/Warsaw, so the test never ages. Run with `npx supabase test db`.
begin;
select plan(36);

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

create function pg_temp.pid(p_user uuid, p_day int) returns uuid
language sql stable as $$
  select id from public.weekly_plans where user_id = p_user and week_start = pg_temp.d(p_day)
$$;

create function pg_temp.opt_id(p_plan uuid, p_day int, p_type text, p_meal text) returns uuid
language sql stable as $$
  select id from public.plan_meal_options
   where plan_id = p_plan and meal_date = pg_temp.d(p_day) and meal_type = p_type and provider_meal_id = p_meal
   order by variant_index limit 1
$$;

-- Slots of a plan without exactly one chosen option.
create function pg_temp.bad_slots(p_plan uuid) returns table (meal_date date, meal_type text)
language sql stable as $$
  select meal_date, meal_type from public.plan_meal_options
   where plan_id = p_plan
   group by meal_date, meal_type
  having count(*) filter (where is_chosen) <> 1
$$;

-- Every stored plan and option row, except those of p_except (null: all of them).
create function pg_temp.state(p_except uuid)
returns table (
  ord bigint, plan_id uuid, user_id uuid, week_start date, mo_run_id text, raw_payload jsonb,
  received_at timestamptz, saved_at timestamptz, option_id uuid, provider_meal_id text, score smallint,
  is_recommended boolean, is_chosen boolean
)
language sql stable as $$
  select row_number() over (order by p.user_id, p.week_start, o.meal_date, o.meal_type, o.variant_index),
         p.id, p.user_id, p.week_start, p.mo_run_id, p.raw_payload, p.received_at, p.saved_at,
         o.id, o.provider_meal_id, o.score, o.is_recommended, o.is_chosen
    from public.weekly_plans p
    left join public.plan_meal_options o on o.plan_id = p.id
   where p_except is null or p.id <> p_except
   order by 1
$$;

-- The second changed delivery of A's upcoming week at day 8 (sent twice, for the identical re-send).
create function pg_temp.up2_v2() returns jsonb[]
language sql stable as $$
  select array[
    pg_temp.o(8, 'lunch', 0, 'X', 5, false),
    pg_temp.o(8, 'lunch', 1, 'Y', 7, false),
    pg_temp.o(8, 'lunch', 2, 'Q', 9, true),
    pg_temp.o(8, 'lunch', 3, 'Y', 6, false),
    pg_temp.o(8, 'dinner', 0, 'Z', 6, false),
    pg_temp.o(8, 'dinner', 1, 'W', 9, true),
    pg_temp.o(9, 'lunch', 0, 'V', 8, true),
    pg_temp.o(9, 'lunch', 1, 'U', 7, false),
    pg_temp.o(9, 'dinner', 0, 'R', 8, true),
    pg_temp.o(9, 'dinner', 1, 'S', 7, false)
  ]
$$;

create temp table snap as select * from pg_temp.state(null) with no data;
create temp table old_ids (id uuid);
create temp table rec_before (option_id uuid, last_planned_on date);
grant select on snap, rec_before to authenticated;
grant insert on rec_before to authenticated;

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'resend-a@test.local'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'resend-b@test.local');

-- Fixtures, all first deliveries. User A: a past week (day -7), a week starting today (day 0), an
-- upcoming week that is never saved (day 1) and one that gets swapped (day 8). User B: day 8 too.
set local role service_role;
select pg_temp.send('resend-a@test.local', -7, '{"week":"past","v":"1"}',
  pg_temp.o(-7, 'lunch', 0, 'X', 8, true), pg_temp.o(-7, 'lunch', 1, 'Y', 7, false));
select pg_temp.send('resend-a@test.local', 0, '{"week":"today","v":"1"}',
  pg_temp.o(0, 'lunch', 0, 'X', 8, true), pg_temp.o(0, 'lunch', 1, 'Y', 7, false));
select pg_temp.send('resend-a@test.local', 1, '{"week":"up1","v":"1"}',
  pg_temp.o(1, 'lunch', 0, 'X', 8, true), pg_temp.o(1, 'lunch', 1, 'Y', 7, false),
  pg_temp.o(1, 'dinner', 0, 'Z', 8, true), pg_temp.o(1, 'dinner', 1, 'W', 7, false));
select pg_temp.send('resend-a@test.local', 8, '{"week":"up2","v":"1"}',
  pg_temp.o(8, 'lunch', 0, 'X', 8, true), pg_temp.o(8, 'lunch', 1, 'Y', 7, false),
  pg_temp.o(8, 'dinner', 0, 'Z', 8, true), pg_temp.o(8, 'dinner', 1, 'W', 7, false),
  pg_temp.o(9, 'lunch', 0, 'V', 8, true), pg_temp.o(9, 'lunch', 1, 'U', 7, false));
select pg_temp.send('resend-b@test.local', 8, '{"week":"b","v":"1"}',
  pg_temp.o(8, 'lunch', 0, 'X', 8, true), pg_temp.o(8, 'lunch', 1, 'Y', 7, false));
reset role;

-- A received_at in the past, so a write by a re-send (now()) is visible.
update public.weekly_plans set received_at = '2026-01-01 00:00+00';

-- Privileges are unchanged.
select ok(
  not has_function_privilege('authenticated', 'public.ingest_weekly_plan(text, text, date, date, text, jsonb, jsonb)', 'execute'),
  'authenticated cannot execute ingest_weekly_plan'
);
select ok(
  has_function_privilege('service_role', 'public.ingest_weekly_plan(text, text, date, date, text, jsonb, jsonb)', 'execute'),
  'service_role can execute ingest_weekly_plan'
);

-- Never saved: A's day-1 week, MO now recommends Y instead of X.
insert into snap select * from pg_temp.state(pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', 1));
insert into old_ids select id from public.plan_meal_options where plan_id = pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', 1);

set local role service_role;
select is(
  pg_temp.send('resend-a@test.local', 1, '{"week":"up1","v":"2"}',
    pg_temp.o(1, 'lunch', 0, 'X', 6, false), pg_temp.o(1, 'lunch', 1, 'Y', 9, true),
    pg_temp.o(1, 'dinner', 0, 'Z', 8, true), pg_temp.o(1, 'dinner', 1, 'W', 7, false)),
  pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', 1),
  'never saved: a changed re-send returns the same plan_id'
);
reset role;

select is_empty(
  $$ select 1 from public.plan_meal_options o join old_ids using (id) $$,
  'never saved: the old option rows are gone'
);
select results_eq(
  $$ select provider_meal_id, meal_type, score::int, is_chosen from public.plan_meal_options
      where plan_id = pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', 1) order by meal_type, variant_index $$,
  $$ values ('Z', 'dinner', 8, true), ('W', 'dinner', 7, false), ('X', 'lunch', 6, false), ('Y', 'lunch', 9, true) $$,
  'never saved: new scores, and the choices follow the new is_recommended'
);
select ok(
  (select saved_at is null from public.weekly_plans where id = pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', 1)),
  'never saved: saved_at stays null'
);
select is_empty(
  $$ select * from pg_temp.bad_slots(pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', 1)) $$,
  'never saved: one chosen option per slot'
);
select results_eq(
  $$ select * from pg_temp.state(pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', 1)) order by ord $$,
  $$ select * from snap order by ord $$,
  'never saved: A''s other weeks and B''s week are untouched'
);

-- Saved by confirm: A keeps MO's recommendations (Y, Z), then MO moves them to X and W.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.confirm_plan(pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', 1));
reset role;
update public.weekly_plans set saved_at = '2026-01-02 00:00+00'
 where id = pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', 1);

delete from snap;
insert into snap select * from pg_temp.state(pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', 1));

set local role service_role;
select is(
  pg_temp.send('resend-a@test.local', 1, '{"week":"up1","v":"3"}',
    pg_temp.o(1, 'lunch', 0, 'X', 9, true), pg_temp.o(1, 'lunch', 1, 'Y', 6, false),
    pg_temp.o(1, 'dinner', 0, 'Z', 6, false), pg_temp.o(1, 'dinner', 1, 'W', 9, true)),
  pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', 1),
  'saved by confirm: a changed re-send returns the same plan_id'
);
reset role;

select results_eq(
  $$ select provider_meal_id, meal_type, is_recommended, is_chosen from public.plan_meal_options
      where plan_id = pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', 1) order by meal_type, variant_index $$,
  $$ values ('Z', 'dinner', false, true), ('W', 'dinner', true, false), ('X', 'lunch', true, false), ('Y', 'lunch', false, true) $$,
  'saved by confirm: the previously chosen (old recommended) dishes stay chosen'
);
select is(
  (select saved_at from public.weekly_plans where id = pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', 1)),
  '2026-01-02 00:00+00'::timestamptz,
  'saved by confirm: saved_at is unchanged'
);
select is_empty(
  $$ select * from pg_temp.bad_slots(pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', 1)) $$,
  'saved by confirm: one chosen option per slot'
);
select results_eq(
  $$ select * from pg_temp.state(pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', 1)) order by ord $$,
  $$ select * from snap order by ord $$,
  'saved by confirm: A''s other weeks and B''s week are untouched'
);

-- Saved, dish still offered: A swaps day-8 lunch from X to Y. The re-send recommends Q there and W at
-- day-8 dinner, offers Y twice (variants 1 and 3) and adds a day-9 dinner slot.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.choose_plan_option(
  pg_temp.opt_id(pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', 8), 8, 'lunch', 'Y'));
reset role;
update public.weekly_plans set saved_at = '2026-01-03 00:00+00'
 where id = pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', 8);

delete from snap;
insert into snap select * from pg_temp.state(pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', 8));

set local role service_role;
select is(
  pg_temp.send('resend-a@test.local', 8, '{"week":"up2","v":"2"}', variadic pg_temp.up2_v2()),
  pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', 8),
  'saved, dish offered: a changed re-send returns the same plan_id'
);
reset role;

select results_eq(
  $$ select provider_meal_id, score::int from public.plan_meal_options
      where plan_id = pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', 8)
        and meal_date = pg_temp.d(8) and meal_type = 'lunch' order by variant_index $$,
  $$ values ('X', 5), ('Y', 7), ('Q', 9), ('Y', 6) $$,
  'saved, dish offered: the options carry the new scores'
);
select results_eq(
  $$ select meal_date - pg_temp.d(0), meal_type, variant_index::int, provider_meal_id from public.plan_meal_options
      where plan_id = pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', 8) and is_chosen
      order by meal_date, meal_type $$,
  $$ values (8, 'dinner', 0, 'Z'), (8, 'lunch', 1, 'Y'), (9, 'dinner', 0, 'R'), (9, 'lunch', 0, 'V') $$,
  'saved, dish offered: the swapped Y stays chosen (lowest variant), Z stays although W is recommended, the new slot gets R'
);
select is(
  (select saved_at from public.weekly_plans where id = pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', 8)),
  '2026-01-03 00:00+00'::timestamptz,
  'saved, dish offered: saved_at is unchanged'
);
select is_empty(
  $$ select * from pg_temp.bad_slots(pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', 8)) $$,
  'saved, dish offered: one chosen option per slot'
);
select results_eq(
  $$ select * from pg_temp.state(pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', 8)) order by ord $$,
  $$ select * from snap order by ord $$,
  'saved, dish offered: A''s other weeks and B''s week of the same week_start are untouched'
);

-- Identical: the same body again, then the same content with another key order.
update public.weekly_plans set received_at = '2026-01-04 00:00+00'
 where id = pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', 8);
delete from snap;
insert into snap select * from pg_temp.state(null);

set local role service_role;
select is(
  pg_temp.send('resend-a@test.local', 8, '{"week":"up2","v":"2"}', variadic pg_temp.up2_v2()),
  pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', 8),
  'identical: an identical re-send returns the same plan_id'
);
reset role;
select results_eq(
  $$ select * from pg_temp.state(null) order by ord $$,
  $$ select * from snap order by ord $$,
  'identical: option ids, the swapped choice, saved_at and received_at are unchanged'
);

set local role service_role;
select is(
  pg_temp.send('resend-a@test.local', 8, '{"v":"2","week":"up2"}', variadic pg_temp.up2_v2()),
  pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', 8),
  'identical: the same content in another key order returns the same plan_id'
);
reset role;
select results_eq(
  $$ select * from pg_temp.state(null) order by ord $$,
  $$ select * from snap order by ord $$,
  'identical: the same content in another key order changes nothing'
);

-- Saved, dish gone: Y is no longer offered at day-8 lunch; MO now recommends S at day-9 dinner.
delete from snap;
insert into snap select * from pg_temp.state(pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', 8));

set local role service_role;
select is(
  pg_temp.send('resend-a@test.local', 8, '{"week":"up2","v":"3"}',
    pg_temp.o(8, 'lunch', 0, 'X', 5, false), pg_temp.o(8, 'lunch', 1, 'Q', 9, true),
    pg_temp.o(8, 'dinner', 0, 'Z', 6, false), pg_temp.o(8, 'dinner', 1, 'W', 9, true),
    pg_temp.o(9, 'lunch', 0, 'V', 8, true), pg_temp.o(9, 'lunch', 1, 'U', 7, false),
    pg_temp.o(9, 'dinner', 0, 'S', 9, true), pg_temp.o(9, 'dinner', 1, 'R', 6, false)),
  pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', 8),
  'saved, dish gone: a changed re-send returns the same plan_id'
);
reset role;

select results_eq(
  $$ select meal_date - pg_temp.d(0), meal_type, provider_meal_id from public.plan_meal_options
      where plan_id = pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', 8) and is_chosen
      order by meal_date, meal_type $$,
  $$ values (8, 'dinner', 'Z'), (8, 'lunch', 'Q'), (9, 'dinner', 'R'), (9, 'lunch', 'V') $$,
  'saved, dish gone: the slot without Y gets MO''s new recommendation Q, the other slots keep their choices'
);
select is(
  (select saved_at from public.weekly_plans where id = pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', 8)),
  '2026-01-03 00:00+00'::timestamptz,
  'saved, dish gone: saved_at is unchanged'
);
select is_empty(
  $$ select * from pg_temp.bad_slots(pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', 8)) $$,
  'saved, dish gone: one chosen option per slot'
);
select results_eq(
  $$ select * from pg_temp.state(pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', 8)) order by ord $$,
  $$ select * from snap order by ord $$,
  'saved, dish gone: A''s other weeks and B''s week are untouched'
);

-- Started: the week starting today and the past week can't be changed, but an identical re-send is answered.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
insert into rec_before
  select * from public.get_plan_recency(pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', 8));
reset role;
select isnt_empty(
  $$ select * from rec_before $$,
  'recency: the later upcoming week has recency notes before the refused re-send'
);

delete from snap;
insert into snap select * from pg_temp.state(null);

set local role service_role;
select throws_ok(
  $$ select pg_temp.send('resend-a@test.local', 0, '{"week":"today","v":"2"}',
       pg_temp.o(0, 'lunch', 0, 'X', 5, false), pg_temp.o(0, 'lunch', 1, 'Y', 9, true)) $$,
  '55000', 'week_started',
  'started: a changed re-send of the week starting today raises week_started'
);
select throws_ok(
  $$ select pg_temp.send('resend-a@test.local', -7, '{"week":"past","v":"2"}',
       pg_temp.o(-7, 'lunch', 0, 'X', 5, false), pg_temp.o(-7, 'lunch', 1, 'Y', 9, true)) $$,
  '55000', 'week_started',
  'started: a changed re-send of a past week raises week_started'
);
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq(
  $$ select * from public.get_plan_recency(pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', 8)) order by option_id $$,
  $$ select * from rec_before order by option_id $$,
  'recency: the later upcoming week''s recency is the same after the refused re-send'
);
reset role;

set local role service_role;
select is(
  pg_temp.send('resend-a@test.local', 0, '{"week":"today","v":"1"}',
    pg_temp.o(0, 'lunch', 0, 'X', 8, true), pg_temp.o(0, 'lunch', 1, 'Y', 7, false)),
  pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', 0),
  'started: an identical re-send of the week starting today returns its plan_id'
);
reset role;
select results_eq(
  $$ select * from pg_temp.state(null) order by ord $$,
  $$ select * from snap order by ord $$,
  'started: the refused and the identical re-sends change nothing'
);

-- First delivery of a started week is stored.
set local role service_role;
select isnt(
  pg_temp.send('resend-a@test.local', -14, '{"week":"older","v":"1"}',
    pg_temp.o(-14, 'lunch', 0, 'X', 8, true), pg_temp.o(-14, 'lunch', 1, 'Y', 7, false)),
  null::uuid,
  'first delivery of a past week succeeds'
);
reset role;
select results_eq(
  $$ select provider_meal_id, is_chosen from public.plan_meal_options
      where plan_id = pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', -14) order by variant_index $$,
  $$ values ('X', true), ('Y', false) $$,
  'first delivery of a past week stores its options with is_chosen = is_recommended'
);

select * from finish();
rollback;
