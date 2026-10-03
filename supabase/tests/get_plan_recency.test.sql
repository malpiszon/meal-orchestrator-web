-- S-02: pins get_plan_recency's term definitions (see context/changes/recency-annotated-plan/plan.md).
-- Since S-03 (context/changes/swap-and-save-plan/plan.md) "planned" means the user's choice (is_chosen),
-- not MO's recommendation. Run with `npx supabase test db`.
begin;
select plan(6);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@test.local'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'b@test.local');

insert into public.weekly_plans (id, user_id, provider, week_start, week_end, raw_payload) values
  ('10000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'ntfy', '2026-10-05', '2026-10-09', '{}'),
  ('10000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'ntfy', '2026-10-12', '2026-10-16', '{}'),
  ('10000000-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 'other', '2026-09-28', '2026-10-02', '{}'),
  ('20000000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'ntfy', '2026-10-05', '2026-10-09', '{}');

insert into public.plan_meal_options
  (id, plan_id, user_id, meal_date, meal_type, variant_index, provider_meal_id, name, score, is_recommended, is_chosen)
values
  -- User A, earlier week: X chosen, Y only offered.
  ('a1000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', '2026-10-05', 'lunch', 0, 'X', 'X', 8, true, true),
  ('a1000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', '2026-10-05', 'lunch', 1, 'Y', 'Y', 7, false, false),
  -- User A, earlier week, swapped slot: MO recommended V, the user chose W.
  ('a1000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', '2026-10-06', 'lunch', 0, 'V', 'V', 8, true, false),
  ('a1000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', '2026-10-06', 'lunch', 1, 'W', 'W', 7, false, true),
  -- User A, another provider: X chosen on 10-08, must not count.
  ('a3000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', '2026-10-08', 'lunch', 0, 'X', 'X', 8, true, true),
  -- User B: X chosen on 10-10, must be invisible to user A.
  ('b1000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', '2026-10-10', 'lunch', 0, 'X', 'X', 8, true, true),
  -- User A, the annotated week.
  ('a2000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', '2026-10-12', 'lunch', 0, 'Y', 'Y', 9, true, true),
  ('a2000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', '2026-10-12', 'lunch', 1, 'X', 'X', 7, false, false),
  ('a2000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', '2026-10-13', 'lunch', 0, 'X', 'X', 9, true, true),
  ('a2000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', '2026-10-13', 'lunch', 1, 'Y', 'Y', 7, false, false),
  ('a2000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', '2026-10-13', 'dinner', 0, 'Z', 'Z', 7, true, true),
  ('a2000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', '2026-10-14', 'lunch', 0, 'V', 'V', 9, true, true),
  ('a2000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', '2026-10-14', 'lunch', 1, 'W', 'W', 7, false, false);

select ok(
  not has_function_privilege('anon', 'public.get_plan_recency(uuid)', 'execute'),
  'anon cannot execute get_plan_recency'
);
select ok(
  has_function_privilege('authenticated', 'public.get_plan_recency(uuid)', 'execute'),
  'authenticated can execute get_plan_recency'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);

select results_eq(
  $$ select option_id, last_planned_on from public.get_plan_recency('10000000-0000-0000-0000-000000000002') order by option_id $$,
  $$ values
       -- 10-12 X: earlier chosen 10-05; other provider's 10-08 and user B's 10-10 ignored (by the join on user_id; RLS is shown below).
       ('a2000000-0000-0000-0000-000000000002'::uuid, '2026-10-05'::date),
       -- 10-13 X: 10-12 X was only offered, so 10-05 is the latest chosen date.
       ('a2000000-0000-0000-0000-000000000003'::uuid, '2026-10-05'::date),
       -- 10-13 Y: an earlier day of the same plan counts.
       ('a2000000-0000-0000-0000-000000000004'::uuid, '2026-10-12'::date),
       -- 10-14 W: chosen on 10-06 in place of MO's recommendation.
       ('a2000000-0000-0000-0000-000000000007'::uuid, '2026-10-06'::date) $$,
  'most recent earlier planned date per option, same provider, history of the plan owner only'
);

select is_empty(
  $$ select 1 from public.get_plan_recency('10000000-0000-0000-0000-000000000002')
      where option_id in ('a2000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000005') $$,
  'no row for a meal only offered earlier (10-12 Y) or never chosen before (Z)'
);

select results_eq(
  $$ select option_id, last_planned_on from public.get_plan_recency('10000000-0000-0000-0000-000000000002')
      where option_id in ('a2000000-0000-0000-0000-000000000006', 'a2000000-0000-0000-0000-000000000007') $$,
  $$ values ('a2000000-0000-0000-0000-000000000007'::uuid, '2026-10-06'::date) $$,
  'a swap counts: the chosen W was planned on 10-06, the recommended but swapped-away V was not'
);

select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}', true);

select is_empty(
  $$ select 1 from public.get_plan_recency('10000000-0000-0000-0000-000000000002') $$,
  'another user sees nothing for a plan that is not theirs'
);

select * from finish();
rollback;
