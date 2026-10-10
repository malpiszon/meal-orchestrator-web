-- S-01 (testing-migration-date-rules): pins what the deployed Worker calls and reads, so a
-- migration pushed before its code merges keeps the old Worker working (docs/deployment.md). The oracle is
-- the consumer, not the migrations: the RPC call sites (src/lib/keepalive.ts, src/lib/services/plans.ts,
-- src/lib/services/ratings.ts, src/lib/services/auth-links.ts, src/pages/api/mo/deliveries.ts), the row
-- shapes in src/types.ts and the selects in src/lib/services/plans.ts (PLAN_SELECT, getPastPlans).
-- PostgREST calls a function by its argument names, so the names are pinned with the types; a second
-- overload would make the call ambiguous, so each RPC must have exactly one. Adding a column or a grant
-- passes; renaming, retyping or revoking what the Worker uses fails. Run with `npx supabase test db`.
begin;
select plan(40);

-- Identity arguments of every public function named p_name, one element per overload.
create function pg_temp.args(p_name text) returns text[]
language sql stable as $$
  select array_agg(pg_get_function_identity_arguments(p.oid) order by pg_get_function_identity_arguments(p.oid))
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname = p_name
$$;

-- Result type of every public function named p_name, one element per overload.
create function pg_temp.result(p_name text) returns text[]
language sql stable as $$
  select array_agg(pg_get_function_result(p.oid) order by pg_get_function_identity_arguments(p.oid))
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname = p_name
$$;

-- Whether p_role can execute a public function named p_name; null when there is none, which fails both
-- ok(pg_temp.can(...)) and ok(not pg_temp.can(...)).
create function pg_temp.can(p_role text, p_name text) returns boolean
language sql stable as $$
  select bool_or(has_function_privilege(p_role, p.oid, 'execute'))
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname = p_name
$$;

-- keepalive: the Cron Trigger's client uses SUPABASE_KEY (anon), no arguments. The TS ignores the result;
-- the return type is pinned from the schema, so changing it is a deliberate contract change.
select is(pg_temp.args('keepalive'), array['']::text[], 'keepalive takes no arguments');
select is(pg_temp.result('keepalive'), array['timestamp with time zone']::text[], 'keepalive returns timestamptz');
select ok(pg_temp.can('anon', 'keepalive'), 'anon can execute keepalive');

-- get_plan_recency: user client, { p_plan_id }, rows of { option_id, last_planned_on }.
select is(pg_temp.args('get_plan_recency'), array['p_plan_id uuid'], 'get_plan_recency arguments');
select is(pg_temp.result('get_plan_recency'), array['TABLE(option_id uuid, last_planned_on date)'],
  'get_plan_recency returns option_id and last_planned_on');
select ok(pg_temp.can('authenticated', 'get_plan_recency'), 'authenticated can execute get_plan_recency');
select ok(not pg_temp.can('anon', 'get_plan_recency'), 'anon cannot execute get_plan_recency');

-- choose_plan_option: user client, { p_option_id }, the new saved_at.
select is(pg_temp.args('choose_plan_option'), array['p_option_id uuid'], 'choose_plan_option arguments');
select is(pg_temp.result('choose_plan_option'), array['timestamp with time zone'],
  'choose_plan_option returns saved_at as timestamptz');
select ok(pg_temp.can('authenticated', 'choose_plan_option'), 'authenticated can execute choose_plan_option');
select ok(not pg_temp.can('anon', 'choose_plan_option'), 'anon cannot execute choose_plan_option');

-- confirm_plan: user client, { p_plan_id }, the new saved_at.
select is(pg_temp.args('confirm_plan'), array['p_plan_id uuid'], 'confirm_plan arguments');
select is(pg_temp.result('confirm_plan'), array['timestamp with time zone'],
  'confirm_plan returns saved_at as timestamptz');
select ok(pg_temp.can('authenticated', 'confirm_plan'), 'authenticated can execute confirm_plan');
select ok(not pg_temp.can('anon', 'confirm_plan'), 'anon cannot execute confirm_plan');

-- rate_meal: user client, { p_option_id, p_rating } (rating may be null), the stored rating or null.
select is(pg_temp.args('rate_meal'), array['p_option_id uuid, p_rating smallint'], 'rate_meal arguments');
select is(pg_temp.result('rate_meal'), array['smallint'], 'rate_meal returns the rating as smallint');
select ok(pg_temp.can('authenticated', 'rate_meal'), 'authenticated can execute rate_meal');
select ok(not pg_temp.can('anon', 'rate_meal'), 'anon cannot execute rate_meal');

-- get_plan_ratings: user client, { p_plan_id }, rows of { option_id, rating }.
select is(pg_temp.args('get_plan_ratings'), array['p_plan_id uuid'], 'get_plan_ratings arguments');
select is(pg_temp.result('get_plan_ratings'), array['TABLE(option_id uuid, rating smallint)'],
  'get_plan_ratings returns option_id and rating');
select ok(pg_temp.can('authenticated', 'get_plan_ratings'), 'authenticated can execute get_plan_ratings');
select ok(not pg_temp.can('anon', 'get_plan_ratings'), 'anon cannot execute get_plan_ratings');

-- auth_link_is_valid: service-role client, { p_token_hash, p_type, p_lifetime_seconds }, a boolean.
select is(pg_temp.args('auth_link_is_valid'), array['p_token_hash text, p_type text, p_lifetime_seconds integer'],
  'auth_link_is_valid arguments');
select is(pg_temp.result('auth_link_is_valid'), array['boolean'], 'auth_link_is_valid returns boolean');
select ok(pg_temp.can('service_role', 'auth_link_is_valid'), 'service_role can execute auth_link_is_valid');
select ok(not pg_temp.can('anon', 'auth_link_is_valid'), 'anon cannot execute auth_link_is_valid');

-- ingest_weekly_plan: service-role client, the seven p_* arguments of the delivery route, the plan id.
select is(pg_temp.args('ingest_weekly_plan'),
  array['p_email text, p_provider text, p_week_start date, p_week_end date, p_run_id text, p_raw jsonb, p_options jsonb'],
  'ingest_weekly_plan arguments');
select is(pg_temp.result('ingest_weekly_plan'), array['uuid'], 'ingest_weekly_plan returns the plan id as uuid');
select ok(pg_temp.can('service_role', 'ingest_weekly_plan'), 'service_role can execute ingest_weekly_plan');
select ok(not pg_temp.can('anon', 'ingest_weekly_plan'), 'anon cannot execute ingest_weekly_plan');

-- Columns the user client reads: PLAN_SELECT and getPastPlans on weekly_plans (user_id is filtered on),
-- plan_meal_options(*) as PlanMealOption, meal_ratings(rating).
select results_eq(
  $$ select column_name::text collate "default", data_type::text collate "default"
       from information_schema.columns
      where table_schema = 'public' and table_name = 'weekly_plans'
        and column_name in ('id', 'user_id', 'provider', 'week_start', 'week_end', 'received_at', 'saved_at')
      order by column_name $$,
  $$ values ('id', 'uuid'), ('provider', 'text'), ('received_at', 'timestamp with time zone'),
            ('saved_at', 'timestamp with time zone'), ('user_id', 'uuid'), ('week_end', 'date'),
            ('week_start', 'date') $$,
  'weekly_plans has the columns the Worker reads'
);
select results_eq(
  $$ select column_name::text collate "default", data_type::text collate "default"
       from information_schema.columns
      where table_schema = 'public' and table_name = 'plan_meal_options'
        and column_name in ('id', 'meal_date', 'meal_type', 'variant_index', 'provider_meal_id', 'name',
                            'composition', 'nutrition', 'score', 'justifications', 'is_recommended', 'is_chosen')
      order by column_name $$,
  $$ values ('composition', 'text'), ('id', 'uuid'), ('is_chosen', 'boolean'), ('is_recommended', 'boolean'),
            ('justifications', 'jsonb'), ('meal_date', 'date'), ('meal_type', 'text'), ('name', 'text'),
            ('nutrition', 'jsonb'), ('provider_meal_id', 'text'), ('score', 'smallint'),
            ('variant_index', 'smallint') $$,
  'plan_meal_options has the columns the Worker reads'
);
select results_eq(
  $$ select column_name::text collate "default", data_type::text collate "default"
       from information_schema.columns
      where table_schema = 'public' and table_name = 'meal_ratings'
        and column_name in ('option_id', 'rating')
      order by column_name $$,
  $$ values ('option_id', 'uuid'), ('rating', 'smallint') $$,
  'meal_ratings has the columns the Worker reads'
);

-- The embeds: plan_meal_options(*) follows plan_id, meal_ratings(rating) follows option_id, and option_id
-- being the key makes PostgREST embed one object (or null) instead of an array.
select fk_ok('public', 'plan_meal_options', 'plan_id', 'public', 'weekly_plans', 'id');
select fk_ok('public', 'meal_ratings', 'option_id', 'public', 'plan_meal_options', 'id');
select col_is_pk('public', 'meal_ratings', 'option_id', 'meal_ratings.option_id is the primary key');

select ok(has_table_privilege('authenticated', 'public.weekly_plans', 'select'),
  'authenticated can select weekly_plans');
select ok(has_table_privilege('authenticated', 'public.plan_meal_options', 'select'),
  'authenticated can select plan_meal_options');
select ok(has_table_privilege('authenticated', 'public.meal_ratings', 'select'),
  'authenticated can select meal_ratings');

select * from finish();
rollback;
