-- S-13: pins the suggested pick (context/changes/rating-ordered-options/plan.md): adjusted_score, the
-- pick and its tie-break at ingest, the rating that counts (latest earlier rated day, same user and
-- provider), the saved-plan fallback on re-delivery, and the re-pick rate_meal does for the caller's
-- unsaved upcoming plans, with its safeguards. Dates are relative to today in Europe/Warsaw, so the test
-- never ages. Run with `npx supabase test db`.
begin;
select plan(31);

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
create function pg_temp.send(p_email text, p_provider text, p_day int, p_raw jsonb, variadic p_options jsonb[])
returns uuid
language sql volatile as $$
  select public.ingest_weekly_plan(p_email, p_provider, pg_temp.d(p_day), pg_temp.d(p_day + 4),
    p_raw->>'v', p_raw, to_jsonb(p_options))
$$;

create function pg_temp.pid(p_user uuid, p_day int) returns uuid
language sql stable as $$
  select id from public.weekly_plans where user_id = p_user and week_start = pg_temp.d(p_day)
$$;

-- The chosen meals of a plan, by day offset and meal type.
create function pg_temp.chosen(p_plan uuid) returns table (day int, meal_type text, provider_meal_id text)
language sql stable as $$
  select meal_date - pg_temp.d(0), meal_type, provider_meal_id from public.plan_meal_options
   where plan_id = p_plan and is_chosen
   order by meal_date, meal_type
$$;

-- Slots of the test users' plans without exactly one chosen option.
create function pg_temp.bad_slots() returns table (plan_id uuid, meal_date date, meal_type text)
language sql stable as $$
  select plan_id, meal_date, meal_type from public.plan_meal_options
   where user_id in ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002')
   group by plan_id, meal_date, meal_type
  having count(*) filter (where is_chosen) <> 1
$$;

-- Every plan and option row of the test users, except those of p_except.
create function pg_temp.state(p_except uuid)
returns table (plan_id uuid, saved_at timestamptz, option_id uuid, is_chosen boolean)
language sql stable as $$
  select p.id, p.saved_at, o.id, o.is_chosen
    from public.weekly_plans p
    join public.plan_meal_options o on o.plan_id = p.id
   where p.user_id in ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002')
     and p.id <> p_except
$$;

create temp table snap as select * from pg_temp.state(null) with no data;

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'ordered-a@test.local'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'ordered-b@test.local');

-- History, written directly as the table owner. User A, provider ntfy, week of day -14: BAD rated 1,
-- GREAT 5, GOOD 4, OK3 3, FLIP rated 5 on day -13 and 1 on day -12 (the latest). User A, provider
-- other: OTHERPROV rated 1. User B, provider ntfy: OTHERUSER rated 1.
insert into public.weekly_plans (id, user_id, provider, week_start, week_end, raw_payload) values
  ('10000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'ntfy', pg_temp.d(-14), pg_temp.d(-10), '{}'),
  ('10000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'other', pg_temp.d(-21), pg_temp.d(-17), '{}'),
  ('20000000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'ntfy', pg_temp.d(-14), pg_temp.d(-10), '{}');

insert into public.plan_meal_options
  (id, plan_id, user_id, meal_date, meal_type, variant_index, provider_meal_id, name, score, is_recommended, is_chosen)
values
  ('a1000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   pg_temp.d(-14), 'lunch', 0, 'BAD', 'BAD', 8, true, true),
  ('a1000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   pg_temp.d(-14), 'dinner', 0, 'GREAT', 'GREAT', 8, true, true),
  ('a1000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   pg_temp.d(-13), 'lunch', 0, 'GOOD', 'GOOD', 8, true, true),
  ('a1000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   pg_temp.d(-13), 'dinner', 0, 'FLIP', 'FLIP', 8, true, true),
  ('a1000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   pg_temp.d(-12), 'lunch', 0, 'FLIP', 'FLIP', 8, true, true),
  ('a1000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   pg_temp.d(-12), 'dinner', 0, 'OK3', 'OK3', 8, true, true),
  ('a2000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001',
   pg_temp.d(-21), 'lunch', 0, 'OTHERPROV', 'OTHERPROV', 8, true, true),
  ('b1000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002',
   pg_temp.d(-14), 'lunch', 0, 'OTHERUSER', 'OTHERUSER', 8, true, true);

insert into public.meal_ratings (option_id, user_id, rating) values
  ('a1000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 1),
  ('a1000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 5),
  ('a1000000-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 4),
  ('a1000000-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000001', 5),
  ('a1000000-0000-0000-0000-000000000005', 'aaaaaaaa-0000-0000-0000-000000000001', 1),
  ('a1000000-0000-0000-0000-000000000006', 'aaaaaaaa-0000-0000-0000-000000000001', 3),
  ('a2000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 1),
  ('b1000000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 1);

-- Privileges.
select ok(
  not has_function_privilege('anon', 'public.adjusted_score(smallint, smallint)', 'execute'),
  'anon cannot execute adjusted_score'
);
select ok(
  not has_function_privilege('anon', 'public.pick_default_choices(uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.pick_default_choices(uuid)', 'execute'),
  'anon and authenticated cannot execute pick_default_choices'
);
select ok(
  has_function_privilege('authenticated', 'public.rate_meal(uuid, smallint)', 'execute')
    and not has_function_privilege('anon', 'public.rate_meal(uuid, smallint)', 'execute'),
  'rate_meal grants are unchanged'
);

-- adjusted_score.
select results_eq(
  $$ select r, public.adjusted_score(7::smallint, r::smallint)
       from (values (1), (2), (3), (4), (5), (null)) as v(r) order by r nulls last $$,
  $$ values (1, -93), (2, 5), (3, 7), (4, 9), (5, 107), (null, 7) $$,
  'adjusted_score: 5 -> +100, 1 -> -100, 4 -> +2, 2 -> -2, 3 and unrated -> the score'
);

-- Ingest of a never-saved week (day 8).
set local role service_role;
select pg_temp.send('ordered-a@test.local', 'ntfy', 8, '{"week":"w8","v":"1"}',
  -- MO recommends BAD (rated 1).
  pg_temp.o(8, 'lunch', 0, 'BAD', 9, true), pg_temp.o(8, 'lunch', 1, 'ALT', 6, false),
  -- GREAT (rated 5) has a low score.
  pg_temp.o(8, 'dinner', 0, 'X', 9, true), pg_temp.o(8, 'dinner', 1, 'GREAT', 3, false),
  -- GOOD 7 rated 4 (= 9) vs A9 9 unrated (= 9): the MO score decides.
  pg_temp.o(9, 'lunch', 0, 'GOOD', 7, false), pg_temp.o(9, 'lunch', 1, 'A9', 9, true),
  -- OK3 8 rated 3 vs P 8 unrated: equal on both, the lowest variant_index decides (not MO's pick).
  pg_temp.o(9, 'dinner', 0, 'OK3', 8, false), pg_temp.o(9, 'dinner', 1, 'P', 8, true),
  -- FLIP: older 5, newer 1.
  pg_temp.o(10, 'lunch', 0, 'FLIP', 9, true), pg_temp.o(10, 'lunch', 1, 'ALT2', 5, false),
  -- Rated 1 under another provider.
  pg_temp.o(10, 'dinner', 0, 'OTHERPROV', 9, true), pg_temp.o(10, 'dinner', 1, 'ALT3', 5, false),
  -- Rated 1 by another user.
  pg_temp.o(11, 'lunch', 0, 'OTHERUSER', 9, true), pg_temp.o(11, 'lunch', 1, 'ALT4', 5, false));
reset role;

select results_eq(
  $$ select provider_meal_id from pg_temp.chosen(pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', 8))
      where day = 8 and meal_type = 'lunch' $$,
  $$ values ('ALT') $$,
  'ingest: a meal rated 1/5 that MO recommends is not chosen'
);
select results_eq(
  $$ select provider_meal_id from pg_temp.chosen(pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', 8))
      where day = 8 and meal_type = 'dinner' $$,
  $$ values ('GREAT') $$,
  'ingest: a meal rated 5/5 is chosen despite a low MO score'
);
select results_eq(
  $$ select provider_meal_id from pg_temp.chosen(pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', 8))
      where day = 9 and meal_type = 'lunch' $$,
  $$ values ('A9') $$,
  'ingest: A 9/10 unrated beats B 7/10 rated 4/5 (both 9) on MO score'
);
select results_eq(
  $$ select provider_meal_id from pg_temp.chosen(pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', 8))
      where day = 9 and meal_type = 'dinner' $$,
  $$ values ('OK3') $$,
  'ingest: equal adjusted and MO score (3/5 counts as unrated) -> the lowest variant_index'
);
select results_eq(
  $$ select provider_meal_id from pg_temp.chosen(pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', 8))
      where day = 10 and meal_type = 'lunch' $$,
  $$ values ('ALT2') $$,
  'ingest: the latest earlier rated day counts (older 5/5, newer 1/5 -> 1/5)'
);
select results_eq(
  $$ select provider_meal_id from pg_temp.chosen(pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', 8))
      where day = 10 and meal_type = 'dinner' $$,
  $$ values ('OTHERPROV') $$,
  'ingest: a rating of the same meal under another provider is ignored'
);
select results_eq(
  $$ select provider_meal_id from pg_temp.chosen(pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', 8))
      where day = 11 and meal_type = 'lunch' $$,
  $$ values ('OTHERUSER') $$,
  'ingest: another user''s rating is ignored'
);
select results_eq(
  $$ select provider_meal_id from public.plan_meal_options
      where plan_id = pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', 8) and is_recommended
      order by meal_date, meal_type $$,
  $$ values ('X'), ('BAD'), ('P'), ('A9'), ('OTHERPROV'), ('FLIP'), ('OTHERUSER') $$,
  'ingest: is_recommended stays MO''s pick as delivered'
);
select ok(
  (select saved_at is null from public.weekly_plans where id = pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', 8)),
  'ingest: the plan stays unsaved'
);

-- An unrated week (day 15): the pick is MO's recommendation.
set local role service_role;
select pg_temp.send('ordered-a@test.local', 'ntfy', 15, '{"week":"w15","v":"1"}',
  pg_temp.o(15, 'lunch', 0, 'U1', 9, true), pg_temp.o(15, 'lunch', 1, 'U2', 7, false),
  pg_temp.o(15, 'dinner', 0, 'U3', 6, false), pg_temp.o(15, 'dinner', 1, 'U4', 8, true));
reset role;

select is_empty(
  $$ select 1 from public.plan_meal_options
      where plan_id = pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', 15) and is_chosen <> is_recommended $$,
  'ingest: in an unrated week the pick is MO''s recommendation'
);

-- Saved-plan re-delivery (day 22): A swaps lunch to K2; dinner keeps L1.
set local role service_role;
select pg_temp.send('ordered-a@test.local', 'ntfy', 22, '{"week":"w22","v":"1"}',
  pg_temp.o(22, 'lunch', 0, 'K1', 9, true), pg_temp.o(22, 'lunch', 1, 'K2', 8, false),
  pg_temp.o(22, 'dinner', 0, 'L1', 9, true), pg_temp.o(22, 'dinner', 1, 'L2', 6, false));
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.choose_plan_option(
  (select id from public.plan_meal_options
    where plan_id = pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', 22) and provider_meal_id = 'K2'));
reset role;
update public.weekly_plans set saved_at = '2026-01-02 00:00+00'
 where id = pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', 22);

-- Re-send: K2 still offered at lunch; L1 gone at dinner, where MO recommends BAD (rated 1); a new slot
-- (day 23) where MO recommends FLIP (rated 1).
set local role service_role;
select pg_temp.send('ordered-a@test.local', 'ntfy', 22, '{"week":"w22","v":"2"}',
  pg_temp.o(22, 'lunch', 0, 'K1', 9, true), pg_temp.o(22, 'lunch', 1, 'K2', 6, false),
  pg_temp.o(22, 'dinner', 0, 'BAD', 9, true), pg_temp.o(22, 'dinner', 1, 'M2', 4, false),
  pg_temp.o(23, 'lunch', 0, 'FLIP', 9, true), pg_temp.o(23, 'lunch', 1, 'N2', 3, false));
reset role;

select results_eq(
  $$ select * from pg_temp.chosen(pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', 22)) $$,
  $$ values (22, 'dinner', 'M2'), (22, 'lunch', 'K2'), (23, 'lunch', 'N2') $$,
  'saved re-delivery: the kept dish stays; where it is gone, and in a new slot, the adjusted pick, not MO''s recommendation'
);
select is(
  (select saved_at from public.weekly_plans where id = pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', 22)),
  '2026-01-02 00:00+00'::timestamptz,
  'saved re-delivery: saved_at is unchanged'
);

-- Late rating. A's started, unsaved week of day -1 (written directly): LATE chosen on day 0 (rateable)
-- and day 1, ALT0 and ALTC only offered.
insert into public.weekly_plans (id, user_id, provider, week_start, week_end, raw_payload) values
  ('10000000-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 'ntfy', pg_temp.d(-1), pg_temp.d(3), '{}');
insert into public.plan_meal_options
  (id, plan_id, user_id, meal_date, meal_type, variant_index, provider_meal_id, name, score, is_recommended, is_chosen)
values
  ('a3000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001',
   pg_temp.d(0), 'lunch', 0, 'LATE', 'LATE', 9, true, true),
  ('a3000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001',
   pg_temp.d(0), 'lunch', 1, 'ALT0', 'ALT0', 5, false, false),
  ('a3000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001',
   pg_temp.d(1), 'lunch', 0, 'LATE', 'LATE', 9, true, true),
  ('a3000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001',
   pg_temp.d(1), 'lunch', 1, 'ALTC', 'ALTC', 5, false, false);

-- Upcoming weeks offering LATE as MO's recommendation: A's unsaved day 29 (ntfy), A's saved day 36
-- (ntfy), A's unsaved day 43 (another provider), B's unsaved day 29 (ntfy). Plus A's unsaved week starting
-- today (ntfy; a first delivery of a started week is stored), the re-pick's cut-off.
set local role service_role;
select pg_temp.send('ordered-a@test.local', 'ntfy', 0, '{"week":"w0","v":"1"}',
  pg_temp.o(0, 'lunch', 0, 'LATE', 9, true), pg_temp.o(0, 'lunch', 1, 'ALT', 5, false));
select pg_temp.send('ordered-a@test.local', 'ntfy', 29, '{"week":"w29","v":"1"}',
  pg_temp.o(29, 'lunch', 0, 'LATE', 9, true), pg_temp.o(29, 'lunch', 1, 'ALT', 5, false),
  pg_temp.o(29, 'dinner', 0, 'D1', 8, true), pg_temp.o(29, 'dinner', 1, 'D2', 6, false));
select pg_temp.send('ordered-a@test.local', 'ntfy', 36, '{"week":"w36","v":"1"}',
  pg_temp.o(36, 'lunch', 0, 'LATE', 9, true), pg_temp.o(36, 'lunch', 1, 'ALT', 5, false));
select pg_temp.send('ordered-a@test.local', 'other', 43, '{"week":"w43","v":"1"}',
  pg_temp.o(43, 'lunch', 0, 'LATE', 9, true), pg_temp.o(43, 'lunch', 1, 'ALT', 5, false));
select pg_temp.send('ordered-b@test.local', 'ntfy', 29, '{"week":"b29","v":"1"}',
  pg_temp.o(29, 'lunch', 0, 'LATE', 9, true), pg_temp.o(29, 'lunch', 1, 'ALT', 5, false));
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.confirm_plan(pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', 36));
reset role;

select results_eq(
  $$ select * from pg_temp.chosen(pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', 29)) $$,
  $$ values (29, 'dinner', 'D1'), (29, 'lunch', 'LATE') $$,
  'late rating: before it, the unsaved upcoming week preselects LATE'
);

insert into snap select * from pg_temp.state(pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', 29));

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(
  public.rate_meal('a3000000-0000-0000-0000-000000000001', 1::smallint),
  1::smallint,
  'late rating: rating LATE 1/5 returns the rating'
);
reset role;

select results_eq(
  $$ select * from pg_temp.chosen(pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', 29)) $$,
  $$ values (29, 'dinner', 'D1'), (29, 'lunch', 'ALT') $$,
  'late rating: the caller''s unsaved upcoming week is re-picked (ALT instead of LATE; other slots as before)'
);
select ok(
  (select saved_at is null from public.weekly_plans where id = pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', 29)),
  'late rating: the re-picked week stays unsaved'
);
select results_eq(
  $$ select * from pg_temp.chosen(pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', 36)) $$,
  $$ values (36, 'lunch', 'LATE') $$,
  'late rating: a saved upcoming week keeps LATE'
);
select results_eq(
  $$ select * from pg_temp.chosen('10000000-0000-0000-0000-000000000003') $$,
  $$ values (0, 'lunch', 'LATE'), (1, 'lunch', 'LATE') $$,
  'late rating: a started unsaved week (the rated meal''s own) keeps LATE'
);
select results_eq(
  $$ select * from pg_temp.chosen(pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', 0)) $$,
  $$ values (0, 'lunch', 'LATE') $$,
  'late rating: an unsaved week starting today (the cut-off) keeps LATE'
);
select results_eq(
  $$ select * from pg_temp.chosen(pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', 43)) $$,
  $$ values (43, 'lunch', 'LATE') $$,
  'late rating: an unsaved upcoming week of another provider keeps LATE'
);
select results_eq(
  $$ select * from pg_temp.chosen(pg_temp.pid('bbbbbbbb-0000-0000-0000-000000000002', 29)) $$,
  $$ values (29, 'lunch', 'LATE') $$,
  'late rating: another user''s unsaved upcoming week keeps LATE'
);
select results_eq(
  $$ select * from pg_temp.state(pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', 29)) order by option_id $$,
  $$ select * from snap order by option_id $$,
  'late rating: every other plan and option row is untouched'
);
select is_empty(
  $$ select * from pg_temp.bad_slots() $$,
  'late rating: exactly one chosen option per slot in every plan of the test users'
);

-- Clearing the rating re-picks back.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(
  public.rate_meal('a3000000-0000-0000-0000-000000000001', null),
  null::smallint,
  'late rating: clearing returns null'
);
reset role;

select results_eq(
  $$ select * from pg_temp.chosen(pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', 29)) $$,
  $$ values (29, 'dinner', 'D1'), (29, 'lunch', 'LATE') $$,
  'late rating: clearing it re-picks LATE'
);
select results_eq(
  $$ select * from pg_temp.state(pg_temp.pid('aaaaaaaa-0000-0000-0000-000000000001', 29)) order by option_id $$,
  $$ select * from snap order by option_id $$,
  'late rating: clearing leaves every other plan untouched'
);
select is_empty(
  $$ select * from pg_temp.bad_slots() $$,
  'late rating: after clearing, exactly one chosen option per slot in every plan of the test users'
);

select * from finish();
rollback;
