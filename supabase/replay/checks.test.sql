-- Test-plan Phase 1 (testing-migration-date-rules): the PRD rules a migration must not break on existing
-- data. supabase/replay/seed.sql creates rows at the previous migration version and snapshots them into
-- the replay_snapshot schema; scripts/migration-replay.sh then applies the newest migration and runs this
-- file. The expected values are the snapshot, i.e. what the users saw before the migration:
-- - the system never changes the choices of a saved plan or of a week that has started (PRD US-01, US-07);
-- - ratings are kept (PRD US-08);
-- - every slot has exactly one chosen option (PRD US-01).
-- Unsaved upcoming plans may legitimately be re-picked by a migration, so their choices are not compared.
-- This file lives outside supabase/tests/ on purpose: the snapshot exists only after the seed, so the
-- default `npx supabase test db` must never pick it up. Run with `npm run test:replay`.
begin;
select plan(8);

-- The seed ran, so the comparisons below are not vacuous.
select ok((select count(*) from replay_snapshot.chosen) > 0, 'the snapshot has chosen options');
select ok((select count(*) from replay_snapshot.ratings) > 0, 'the snapshot has ratings');
select ok((select count(*) from replay_snapshot.plans where saved_at is not null) > 0,
  'the snapshot has saved plans');

-- US-01, US-07: the chosen option of every snapshotted slot is unchanged.
select bag_eq(
  $$ select o.plan_id, o.meal_date, o.meal_type, o.provider_meal_id
       from public.plan_meal_options o
      where o.is_chosen
        and o.plan_id in (select plan_id from replay_snapshot.chosen) $$,
  $$ select plan_id, meal_date, meal_type, provider_meal_id from replay_snapshot.chosen $$,
  'saved plans and started weeks keep their chosen options'
);

-- US-08: ratings are kept, with their option and time.
select bag_eq(
  $$ select option_id, user_id, rating, rated_at from public.meal_ratings $$,
  $$ select option_id, user_id, rating, rated_at from replay_snapshot.ratings $$,
  'ratings are unchanged'
);

-- Plans keep their saved state and dates.
select bag_eq(
  $$ select id, saved_at, week_start, week_end from public.weekly_plans $$,
  $$ select plan_id, saved_at, week_start, week_end from replay_snapshot.plans $$,
  'every plan keeps its saved_at, week_start and week_end'
);

-- US-01: one chosen option per slot, in every plan (unsaved upcoming plans included).
select is_empty(
  $$ select plan_id, meal_date, meal_type
       from public.plan_meal_options
      group by plan_id, meal_date, meal_type
     having count(*) filter (where is_chosen) <> 1 $$,
  'every slot has exactly one chosen option'
);
select ok(
  (select count(*) from public.plan_meal_options) > 0,
  'the option rows are still there'
);

select * from finish();
rollback;
