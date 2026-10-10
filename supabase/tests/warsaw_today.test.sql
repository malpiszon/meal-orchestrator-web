-- S-01 (testing-migration-date-rules): pins the single SQL "today"
-- (20261010120000_warsaw_today_helper.sql). "Today" is the calendar date in Europe/Warsaw (docs/api.md),
-- so a week locks and the rating window moves at Warsaw midnight, 22:00 UTC in summer (CEST) and 23:00
-- UTC in winter (CET; the clocks go back on 2026-10-25). The helpers are private: no usage on their
-- schema and no execute for the API roles. The guard fails when any function in public or private derives
-- a date without the helper, so a pinned today in the boundary tests can't be bypassed. Plain now() stays
-- allowed: it stamps received_at, saved_at and rated_at, and keepalive and auth_link_is_valid use it as a
-- timestamp. Run with `npx supabase test db`.
begin;
select plan(15);

-- Warsaw midnight in summer time (CEST, UTC+2).
select is(private.warsaw_date('2026-10-18 21:59:59+00'), date '2026-10-18',
  '21:59:59Z in CEST is still the same Warsaw day');
select is(private.warsaw_date('2026-10-18 22:00:00+00'), date '2026-10-19',
  '22:00Z in CEST is the next Warsaw day');
-- Warsaw midnight in winter time (CET, UTC+1), after the 2026-10-25 switch.
select is(private.warsaw_date('2026-10-25 22:59:59+00'), date '2026-10-25',
  '22:59:59Z in CET is still the same Warsaw day');
select is(private.warsaw_date('2026-10-25 23:00:00+00'), date '2026-10-26',
  '23:00Z in CET is the next Warsaw day');
-- Sunday 22:30Z in CEST is Monday 00:30 in Warsaw: the week starting that Monday has started.
select is(private.warsaw_date('2026-10-11 22:30:00+00'), date '2026-10-12',
  'Sunday 22:30Z in CEST is the Monday in Warsaw');

select is(private.warsaw_today(), private.warsaw_date(now()), 'warsaw_today is the Warsaw date of now()');

-- Privileges: the schema and the helpers are closed to the API roles. PUBLIC gets EXECUTE on a new
-- function by default, so the PUBLIC rows pin the revoke.
select schema_privs_are('private', 'anon', array[]::text[], 'anon has no usage on schema private');
select schema_privs_are('private', 'authenticated', array[]::text[],
  'authenticated has no usage on schema private');
select function_privs_are('private', 'warsaw_date', array['timestamptz'], 'anon', array[]::text[],
  'anon cannot execute private.warsaw_date');
select function_privs_are('private', 'warsaw_date', array['timestamptz'], 'authenticated', array[]::text[],
  'authenticated cannot execute private.warsaw_date');
select function_privs_are('private', 'warsaw_today', array[]::text[], 'anon', array[]::text[],
  'anon cannot execute private.warsaw_today');
select function_privs_are('private', 'warsaw_today', array[]::text[], 'authenticated', array[]::text[],
  'authenticated cannot execute private.warsaw_today');
select function_privs_are('private', 'warsaw_date', array['timestamptz'], 'public', array[]::text[],
  'PUBLIC cannot execute private.warsaw_date');
select function_privs_are('private', 'warsaw_today', array[]::text[], 'public', array[]::text[],
  'PUBLIC cannot execute private.warsaw_today');

-- Guard: only private.warsaw_date turns an instant into a date explicitly (time-zone conversion,
-- current_date/localtime, 'today', date(...), or a cast of now()/current_timestamp/*_timestamp() to date).
-- A regex can't see implicit assignment casts (`v_today date := now();`); the pinned-today boundary
-- tests catch those for the rules they cover. Functions an extension owns (pgTAP) are skipped.
select is_empty(
  $$ select p.oid::regprocedure
       from pg_proc p
      where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
        and p.oid <> 'private.warsaw_date(timestamptz)'::regprocedure
        and p.prosrc ~* ('at time zone|timezone\s*\(|current_date|localtime(stamp)?|''today''|\mdate\s*\('
                         '|cast\s*\(\s*(now|current_timestamp|statement_timestamp|clock_timestamp|transaction_timestamp)\M[^;]*\sas\s+date\M'
                         '|(now\(\)|current_timestamp(\s*\(\s*\d*\s*\))?|(statement|clock|transaction)_timestamp\(\))(\s*::\s*\w+)*\s*::\s*date\M')
        and not exists (
          select 1 from pg_depend d
           where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
        ) $$,
  'no function derives a date explicitly without private.warsaw_today'
);

select * from finish();
rollback;
