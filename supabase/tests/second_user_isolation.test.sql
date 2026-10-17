-- S-03 (testing-data-isolation): the isolation sweep. User B and anon act against user A's real data on
-- every table and every callable function of the allowlist in exposed_surface.test.sql, and must get none
-- of A's rows back and change none of A's state. The oracle is PRD US-03 (a user sees and changes only
-- their own plans) and docs/api.md (someone else's plan, option or rating answers not_found, exactly like
-- one that does not exist), not the policies or functions. Fixtures go through the real RPCs
-- (ingest_weekly_plan, choose_plan_option, confirm_plan, rate_meal), so the closing user_id invariant runs
-- on the rows the app actually writes. A table or function added to the allowlist adds its case here: a
-- read and the three direct writes for a table, a call with A's ids for a definer function, an empty
-- result for an invoker one, and a 42501 for anon (and for B when only service_role may call it).
-- Allowlist rows without a B case: keepalive() returns now() and adjusted_score() is pure arithmetic, so
-- neither reads or writes any row (anon is still refused adjusted_score below); graphql_public.graphql()
-- is Supabase's stub when pg_graphql isn't installed and only returns an error (if pg_graphql is enabled,
-- it resolves through the same grants and RLS this file checks). Today is pinned to 2026-03-30 (T), so
-- pg_temp.d(n) is T + n days. Run with `npx supabase test db`.
begin;
select plan(46);

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

-- One option of a delivery payload.
create function pg_temp.o(p_day int, p_variant int, p_meal text, p_score int, p_rec boolean)
returns jsonb
language sql immutable as $$
  select jsonb_build_object('meal_date', pg_temp.d(p_day), 'meal_type', 'lunch', 'variant_index', p_variant,
    'provider_meal_id', p_meal, 'name', p_meal, 'score', p_score, 'is_recommended', p_rec)
$$;

-- A delivery for p_email of the week starting at p_day, as the delivery route makes it.
create function pg_temp.send(p_email text, p_day int, variadic p_options jsonb[])
returns uuid
language sql volatile as $$
  select public.ingest_weekly_plan(p_email, 'ntfy', pg_temp.d(p_day), pg_temp.d(p_day + 4), 'run-' || p_day,
    jsonb_build_object('email', p_email, 'week', p_day), to_jsonb(p_options))
$$;

-- Ids of A's and B's rows by name, read while postgres and readable by the API roles, so the sweep can
-- aim at A's rows that RLS hides from B.
create temp table refs (name text primary key, id uuid not null);
grant select on refs to authenticated, anon;

create function pg_temp.ref(p_name text) returns uuid
language sql stable as $$ select id from refs where name = p_name $$;

-- A and B.
insert into auth.users (id, email) values
  ('5e5e5e5e-0000-0000-0000-00000000000a', 'isolation-a@test.local'),
  ('5e5e5e5e-0000-0000-0000-00000000000b', 'isolation-b@test.local');

-- Deliveries. A: the week starting T-7 (started, SOUP on T-3 is in the rating window), and the upcoming
-- weeks starting T+7 and T+14 (both offer SOUP and STEW, so A's history gives the second one a recency
-- note and a rating). B: the week starting T-7 (so B can rate) and the upcoming week starting T+7.
set local role service_role;
select pg_temp.send('isolation-a@test.local', -7, pg_temp.o(-3, 0, 'SOUP', 8, true), pg_temp.o(-3, 1, 'STEW', 7, false));
select pg_temp.send('isolation-a@test.local', 7, pg_temp.o(8, 0, 'SOUP', 8, true), pg_temp.o(8, 1, 'STEW', 7, false));
select pg_temp.send('isolation-a@test.local', 14, pg_temp.o(15, 0, 'SOUP', 8, true), pg_temp.o(15, 1, 'STEW', 7, false));
select pg_temp.send('isolation-b@test.local', -7, pg_temp.o(-3, 0, 'SOUP', 8, true));
select pg_temp.send('isolation-b@test.local', 7, pg_temp.o(8, 0, 'SOUP', 8, true), pg_temp.o(8, 1, 'STEW', 7, false));
reset role;

insert into refs (name, id)
select format('%s_plan_%s', u.who, p.week_start - pg_temp.d(0)), p.id
  from public.weekly_plans p
  join (values ('a', '5e5e5e5e-0000-0000-0000-00000000000a'::uuid),
               ('b', '5e5e5e5e-0000-0000-0000-00000000000b'::uuid)) u (who, user_id)
    on u.user_id = p.user_id
union all
select format('%s_%s_%s', u.who, o.provider_meal_id, p.week_start - pg_temp.d(0)), o.id
  from public.plan_meal_options o
  join public.weekly_plans p on p.id = o.plan_id
  join (values ('a', '5e5e5e5e-0000-0000-0000-00000000000a'::uuid),
               ('b', '5e5e5e5e-0000-0000-0000-00000000000b'::uuid)) u (who, user_id)
    on u.user_id = p.user_id;

-- A swaps the week starting T+7 to STEW and saves it, and rates T-3's SOUP 5/5 (which re-picks the
-- unsaved week starting T+14). B rates its own T-3 SOUP, so B has a row in every table.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"5e5e5e5e-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select public.choose_plan_option(pg_temp.ref('a_STEW_7'));
select public.confirm_plan(pg_temp.ref('a_plan_7'));
select public.rate_meal(pg_temp.ref('a_SOUP_-7'), 5::smallint);

-- The invoker RPCs return rows for A's own plan, so B's empty results below mean scoping, not no data.
select isnt_empty(
  $$ select * from public.get_plan_recency(pg_temp.ref('a_plan_14')) $$,
  'fixture: A sees a recency note on its week starting T+14'
);
select isnt_empty(
  $$ select * from public.get_plan_ratings(pg_temp.ref('a_plan_14')) $$,
  'fixture: A sees an earlier rating on its week starting T+14'
);

select set_config('request.jwt.claims', '{"sub":"5e5e5e5e-0000-0000-0000-00000000000b","role":"authenticated"}', true);
select public.rate_meal(pg_temp.ref('b_SOUP_-7'), 3::smallint);
reset role;

-- A's full rows, as the owner, to compare after the sweep.
create temp table snap_plans as
  select * from public.weekly_plans where user_id = '5e5e5e5e-0000-0000-0000-00000000000a';
create temp table snap_options as
  select * from public.plan_meal_options where user_id = '5e5e5e5e-0000-0000-0000-00000000000a';
create temp table snap_ratings as
  select * from public.meal_ratings where user_id = '5e5e5e5e-0000-0000-0000-00000000000a';

-- B's choose and confirm targets below are still changeable for A, so a missing ownership check would
-- show in the snapshot comparison rather than be a no-op.
select is(
  (select is_chosen from public.plan_meal_options where id = pg_temp.ref('a_STEW_14')),
  false,
  'fixture: A''s STEW on its week starting T+14 is not chosen'
);
select is(
  (select saved_at from public.weekly_plans where id = pg_temp.ref('a_plan_14')),
  null,
  'fixture: A''s week starting T+14 is not saved'
);

-- As B.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"5e5e5e5e-0000-0000-0000-00000000000b","role":"authenticated"}', true);

-- Reads: nothing that is not B's, and B's own rows are there (the read itself works).
select is(
  (select count(*) from public.weekly_plans where user_id <> '5e5e5e5e-0000-0000-0000-00000000000b'),
  0::bigint,
  'B reads no weekly_plans row of another user'
);
select ok(
  (select count(*) from public.weekly_plans where user_id = '5e5e5e5e-0000-0000-0000-00000000000b') > 0,
  'B reads its own weekly_plans rows'
);
select is(
  (select count(*) from public.plan_meal_options where user_id <> '5e5e5e5e-0000-0000-0000-00000000000b'),
  0::bigint,
  'B reads no plan_meal_options row of another user'
);
select ok(
  (select count(*) from public.plan_meal_options where user_id = '5e5e5e5e-0000-0000-0000-00000000000b') > 0,
  'B reads its own plan_meal_options rows'
);
select is(
  (select count(*) from public.meal_ratings where user_id <> '5e5e5e5e-0000-0000-0000-00000000000b'),
  0::bigint,
  'B reads no meal_ratings row of another user'
);
select ok(
  (select count(*) from public.meal_ratings where user_id = '5e5e5e5e-0000-0000-0000-00000000000b') > 0,
  'B reads its own meal_ratings row'
);

-- Direct writes: no write grant on any table. UPDATE and DELETE aim at A's rows.
select throws_ok(
  $$ insert into public.weekly_plans (user_id, provider, week_start, week_end, raw_payload)
     values ('5e5e5e5e-0000-0000-0000-00000000000b', 'ntfy', pg_temp.d(21), pg_temp.d(25), '{}') $$,
  '42501', null,
  'B cannot insert into weekly_plans'
);
select throws_ok(
  $$ update public.weekly_plans set saved_at = null where id = pg_temp.ref('a_plan_7') $$,
  '42501', null,
  'B cannot update A''s weekly_plans row'
);
select throws_ok(
  $$ delete from public.weekly_plans where id = pg_temp.ref('a_plan_7') $$,
  '42501', null,
  'B cannot delete A''s weekly_plans row'
);
select throws_ok(
  $$ insert into public.plan_meal_options
       (plan_id, user_id, meal_date, meal_type, variant_index, provider_meal_id, name, score, is_recommended)
     values (pg_temp.ref('a_plan_7'), '5e5e5e5e-0000-0000-0000-00000000000b', pg_temp.d(9), 'lunch', 0, 'X', 'X',
             8, true) $$,
  '42501', null,
  'B cannot insert into plan_meal_options'
);
select throws_ok(
  $$ update public.plan_meal_options set is_chosen = true where id = pg_temp.ref('a_SOUP_7') $$,
  '42501', null,
  'B cannot update A''s plan_meal_options row'
);
select throws_ok(
  $$ delete from public.plan_meal_options where id = pg_temp.ref('a_SOUP_7') $$,
  '42501', null,
  'B cannot delete A''s plan_meal_options row'
);
select throws_ok(
  $$ insert into public.meal_ratings (option_id, user_id, rating)
     values (pg_temp.ref('a_SOUP_-7'), '5e5e5e5e-0000-0000-0000-00000000000b', 1) $$,
  '42501', null,
  'B cannot insert into meal_ratings'
);
select throws_ok(
  $$ update public.meal_ratings set rating = 1 where option_id = pg_temp.ref('a_SOUP_-7') $$,
  '42501', null,
  'B cannot update A''s meal_ratings row'
);
select throws_ok(
  $$ delete from public.meal_ratings where option_id = pg_temp.ref('a_SOUP_-7') $$,
  '42501', null,
  'B cannot delete A''s meal_ratings row'
);

-- Definer RPCs with A's ids: not_found, as for an unknown id. Each target would be accepted for A (an
-- unsaved upcoming plan, its unchosen option, A's rated meal in the window), so a missing ownership check
-- would write.
select throws_ok(
  $$ select public.choose_plan_option(pg_temp.ref('a_STEW_14')) $$,
  'P0002', 'not_found',
  'B choosing A''s option raises not_found'
);
select throws_ok(
  $$ select public.confirm_plan(pg_temp.ref('a_plan_14')) $$,
  'P0002', 'not_found',
  'B confirming A''s plan raises not_found'
);
select throws_ok(
  $$ select public.rate_meal(pg_temp.ref('a_SOUP_-7'), 4::smallint) $$,
  'P0002', 'not_found',
  'B rating A''s meal raises not_found'
);
select throws_ok(
  $$ select public.rate_meal(pg_temp.ref('a_SOUP_-7'), null) $$,
  'P0002', 'not_found',
  'B clearing A''s rating raises not_found'
);

-- Invoker RPCs: RLS scopes them to B, so A's plan yields nothing.
select is_empty(
  $$ select * from public.get_plan_recency(pg_temp.ref('a_plan_14')) $$,
  'B gets no recency notes for A''s plan'
);
select is_empty(
  $$ select * from public.get_plan_ratings(pg_temp.ref('a_plan_14')) $$,
  'B gets no ratings for A''s plan'
);

-- Service-role RPCs: not executable by authenticated.
select throws_ok(
  $$ select public.ingest_weekly_plan('isolation-a@test.local', 'ntfy', pg_temp.d(21), pg_temp.d(25), 'run-b',
       '{}'::jsonb, '[]'::jsonb) $$,
  '42501', null,
  'B cannot execute ingest_weekly_plan'
);
select throws_ok(
  $$ select public.pick_default_choices(pg_temp.ref('a_plan_14')) $$,
  '42501', null,
  'B cannot execute pick_default_choices'
);
select throws_ok(
  $$ select public.auth_link_is_valid('hash', 'invite', 86400) $$,
  '42501', null,
  'B cannot execute auth_link_is_valid'
);
reset role;

-- As anon: SELECT is granted but the policies are for authenticated only, so no row comes back; every
-- function but keepalive (and the graphql stub) is refused.
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is_empty($$ select * from public.weekly_plans $$, 'anon reads no weekly_plans row');
select is_empty($$ select * from public.plan_meal_options $$, 'anon reads no plan_meal_options row');
select is_empty($$ select * from public.meal_ratings $$, 'anon reads no meal_ratings row');
-- anon reads the fixture ids, so the 42501s below come from the functions, not from refs.
select isnt(pg_temp.ref('a_plan_14'), null, 'fixture: anon can read the refs fixture');
select throws_ok(
  $$ select * from public.get_plan_recency(pg_temp.ref('a_plan_14')) $$,
  '42501', null,
  'anon cannot execute get_plan_recency'
);
select throws_ok(
  $$ select * from public.get_plan_ratings(pg_temp.ref('a_plan_14')) $$,
  '42501', null,
  'anon cannot execute get_plan_ratings'
);
select throws_ok(
  $$ select public.adjusted_score(8::smallint, 5::smallint) $$,
  '42501', null,
  'anon cannot execute adjusted_score'
);
select throws_ok(
  $$ select public.choose_plan_option(pg_temp.ref('a_STEW_14')) $$,
  '42501', null,
  'anon cannot execute choose_plan_option'
);
select throws_ok(
  $$ select public.confirm_plan(pg_temp.ref('a_plan_14')) $$,
  '42501', null,
  'anon cannot execute confirm_plan'
);
select throws_ok(
  $$ select public.rate_meal(pg_temp.ref('a_SOUP_-7'), null) $$,
  '42501', null,
  'anon cannot execute rate_meal'
);
select throws_ok(
  $$ select public.ingest_weekly_plan('isolation-a@test.local', 'ntfy', pg_temp.d(21), pg_temp.d(25), 'run-anon',
       '{}'::jsonb, '[]'::jsonb) $$,
  '42501', null,
  'anon cannot execute ingest_weekly_plan'
);
select throws_ok(
  $$ select public.pick_default_choices(pg_temp.ref('a_plan_14')) $$,
  '42501', null,
  'anon cannot execute pick_default_choices'
);
select throws_ok(
  $$ select public.auth_link_is_valid('hash', 'invite', 86400) $$,
  '42501', null,
  'anon cannot execute auth_link_is_valid'
);
reset role;

-- A's state is unchanged, column by column.
select set_eq(
  $$ select * from public.weekly_plans where user_id = '5e5e5e5e-0000-0000-0000-00000000000a' $$,
  $$ select * from snap_plans $$,
  'A''s weekly_plans rows are unchanged'
);
select set_eq(
  $$ select * from public.plan_meal_options where user_id = '5e5e5e5e-0000-0000-0000-00000000000a' $$,
  $$ select * from snap_options $$,
  'A''s plan_meal_options rows are unchanged'
);
select set_eq(
  $$ select * from public.meal_ratings where user_id = '5e5e5e5e-0000-0000-0000-00000000000a' $$,
  $$ select * from snap_ratings $$,
  'A''s meal_ratings rows are unchanged'
);

-- The policies scope children by their own user_id, so it must equal the plan's on every row. These scan
-- every committed row on purpose (dev and smoke data locally, the replay seed in CI), not just A's and
-- B's: a failure means some committed row is inconsistent, not that this file is flaky.
select is_empty(
  $$ select o.id from public.plan_meal_options o
       join public.weekly_plans p on p.id = o.plan_id
      where o.user_id <> p.user_id $$,
  'every plan_meal_options row has its plan''s user_id'
);
select is_empty(
  $$ select r.option_id from public.meal_ratings r
       join public.plan_meal_options o on o.id = r.option_id
       join public.weekly_plans p on p.id = o.plan_id
      where r.user_id <> p.user_id $$,
  'every meal_ratings row has its option''s plan''s user_id'
);

select * from finish();
rollback;
