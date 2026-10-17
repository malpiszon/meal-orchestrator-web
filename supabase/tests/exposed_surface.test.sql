-- S-03 (testing-data-isolation): pins everything the public keys (anon, authenticated) can reach through
-- the exposed schemas (supabase/config.toml: public, graphql_public), so a new table, policy, grant or
-- callable function, or a function turned security definer, fails here with a diff naming it. The oracle
-- is the surface reviewed for isolation (context/changes/testing-data-isolation/research.md), not the
-- migrations: Supabase's default privileges grant anon and authenticated everything on a new object in
-- public, so a migration that forgets its revokes still matches itself. When this fails after your
-- migration: revoke what the API roles must not have; if they should have it, add the row here and add a
-- case for it to second_user_isolation.test.sql (a new table, policy or definer function always needs
-- one). Objects an extension owns (pgTAP) are skipped. Run with `npx supabase test db`.
begin;
select plan(9);

-- Relations, with their RLS flag: the three plan tables (20261001120000_weekly_plans,
-- 20261008120000_meal_ratings). graphql_public has none.
select set_eq(
  $$ select format('%s.%s', n.nspname, c.relname) collate "default", c.relkind::text collate "default",
            c.relrowsecurity
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('public', 'graphql_public')
        and c.relkind in ('r', 'p', 'v', 'm', 'f')
        and not exists (
          select 1 from pg_depend d
           where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e'
        ) $$,
  $$ values ('public.weekly_plans', 'r', true), ('public.plan_meal_options', 'r', true),
            ('public.meal_ratings', 'r', true) $$,
  'the exposed schemas hold only the three plan tables, each with RLS on'
);

-- Sequences: none (the tables use uuid keys); the default privileges would grant them rwU.
select is_empty(
  $$ select format('%s.%s', n.nspname, c.relname)
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('public', 'graphql_public')
        and c.relkind = 'S' $$,
  'the exposed schemas hold no sequences'
);

-- Policies: one SELECT policy per table, own rows only (20261001120000_weekly_plans for weekly_plans and
-- plan_meal_options, 20261008120000_meal_ratings for meal_ratings).
select set_eq(
  $$ select format('%s.%s', schemaname, tablename) collate "default", policyname::text collate "default",
            cmd collate "default", roles::text collate "default", permissive collate "default",
            qual collate "default", with_check collate "default"
       from pg_policies
      where schemaname in ('public', 'graphql_public') $$,
  $$ values
       ('public.weekly_plans', 'weekly_plans_select_own_authenticated', 'SELECT', '{authenticated}',
        'PERMISSIVE', '(user_id = ( SELECT auth.uid() AS uid))', null::text),
       ('public.plan_meal_options', 'plan_meal_options_select_own_authenticated', 'SELECT', '{authenticated}',
        'PERMISSIVE', '(user_id = ( SELECT auth.uid() AS uid))', null::text),
       ('public.meal_ratings', 'meal_ratings_select_own_authenticated', 'SELECT', '{authenticated}',
        'PERMISSIVE', '(user_id = ( SELECT auth.uid() AS uid))', null::text) $$,
  'the exposed tables have only the three own-rows SELECT policies'
);

-- Table grants: SELECT, REFERENCES and TRIGGER are left after the write revokes in
-- 20261001120000_weekly_plans and 20261008120000_meal_ratings. Neither role can create objects (below), so
-- REFERENCES and TRIGGER can't be used.
select set_eq(
  $$ select format('%s.%s', table_schema, table_name) collate "default", grantee::text collate "default",
            privilege_type::text collate "default"
       from information_schema.role_table_grants
      where table_schema in ('public', 'graphql_public')
        and grantee in ('anon', 'authenticated') $$,
  $$ select t, r, p
       from unnest(array['public.weekly_plans', 'public.plan_meal_options', 'public.meal_ratings']) t,
            unnest(array['anon', 'authenticated']) r,
            unnest(array['SELECT', 'REFERENCES', 'TRIGGER']) p $$,
  'anon and authenticated hold only SELECT, REFERENCES and TRIGGER on the exposed tables'
);

-- Column grants: none. role_column_grants also lists columns covered by a table grant, so read attacl.
select is_empty(
  $$ select format('%s.%s.%s', n.nspname, c.relname, a.attname)
       from pg_attribute a
       join pg_class c on c.oid = a.attrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('public', 'graphql_public')
        and a.attacl is not null $$,
  'no column in the exposed schemas has its own grant'
);

-- Callable functions, as (function, role, security definer). The definer rows skip RLS: each one checks
-- p.user_id = auth.uid() before writing (final bodies in 20261010120000_warsaw_today_helper), and a new
-- definer row needs a matching case in second_user_isolation.test.sql.
select set_eq(
  $$ select format('%s.%s(%s)', n.nspname, p.proname, oidvectortypes(p.proargtypes)) collate "default",
            r.rolname::text collate "default", p.prosecdef
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       cross join (values ('anon'::name), ('authenticated'::name)) r (rolname)
      where n.nspname in ('public', 'graphql_public')
        and has_function_privilege(r.rolname, p.oid, 'execute')
        and not exists (
          select 1 from pg_depend d
           where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
        ) $$,
  $$ values
       -- 20260925192719_keepalive_function: returns now(), the Cron Trigger calls it with the anon key.
       ('public.keepalive()', 'anon', false),
       ('public.keepalive()', 'authenticated', false),
       -- Supabase's stub when pg_graphql isn't installed (not a migration); it only returns an error. If
       -- pg_graphql is enabled, the extension's own graphql() replaces it and this row goes missing.
       ('graphql_public.graphql(text, text, jsonb, jsonb)', 'anon', false),
       ('graphql_public.graphql(text, text, jsonb, jsonb)', 'authenticated', false),
       -- 20261002190000_plan_recency: invoker, scoped by RLS.
       ('public.get_plan_recency(uuid)', 'authenticated', false),
       -- 20261008120000_meal_ratings: invoker, scoped by RLS.
       ('public.get_plan_ratings(uuid)', 'authenticated', false),
       -- 20261008180000_rating_ordered_defaults: pure arithmetic, reads no data.
       ('public.adjusted_score(smallint, smallint)', 'authenticated', false),
       -- 20261003120000_plan_choices: definer, checks auth.uid().
       ('public.choose_plan_option(uuid)', 'authenticated', true),
       ('public.confirm_plan(uuid)', 'authenticated', true),
       -- 20261008120000_meal_ratings: definer, checks auth.uid().
       ('public.rate_meal(uuid, smallint)', 'authenticated', true) $$,
  'anon and authenticated can execute only the reviewed functions, with the reviewed definer flags'
);

-- Schemas: the date helpers' schema stays closed (20261010120000_warsaw_today_helper), and neither role
-- can create objects anywhere. A session's own temp schemas are skipped: any role may create temp objects.
select schema_privs_are('private', 'anon', array[]::text[], 'anon has no usage on schema private');
select schema_privs_are('private', 'authenticated', array[]::text[],
  'authenticated has no usage on schema private');
select is_empty(
  $$ select n.nspname, r.rolname
       from pg_namespace n
       cross join (values ('anon'::name), ('authenticated'::name)) r (rolname)
      where has_schema_privilege(r.rolname, n.oid, 'create')
        and n.nspname !~ '^pg_(toast_)?temp_' $$,
  'neither anon nor authenticated can create objects in any schema'
);

select * from finish();
rollback;
