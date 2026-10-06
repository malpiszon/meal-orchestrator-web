-- S-10: pins auth_link_is_valid, the read-only mirror of GoTrue v2.197.0's token_hash lookup and
-- expiry check (see context/changes/expired-link-notice/plan.md). Sent-at values are relative to
-- now(), so the test never ages. Each user holds one link, as GoTrue keeps one row per token type.
-- Run with `npx supabase test db`.
begin;
select plan(14);

insert into auth.users (id, email, recovery_sent_at, confirmation_sent_at) values
  ('11111111-0000-0000-0000-000000000001', 'link-recovery@test.local',       now() - interval '10 minutes', null),
  ('11111111-0000-0000-0000-000000000002', 'link-invite@test.local',         null, now() - interval '10 minutes'),
  ('11111111-0000-0000-0000-000000000003', 'link-recovery-61@test.local',    now() - interval '61 minutes', null),
  ('11111111-0000-0000-0000-000000000004', 'link-invite-61@test.local',      null, now() - interval '61 minutes'),
  ('11111111-0000-0000-0000-000000000005', 'link-recovery-59@test.local',    now() - interval '59 minutes', null),
  ('11111111-0000-0000-0000-000000000006', 'link-invite-59@test.local',      null, now() - interval '59 minutes'),
  ('11111111-0000-0000-0000-000000000007', 'link-recovery-null@test.local',  null, null);

insert into auth.one_time_tokens (id, user_id, token_type, token_hash, relates_to) values
  ('22222222-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'recovery_token',     'hash-recovery',      'link-recovery@test.local'),
  ('22222222-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000002', 'confirmation_token', 'hash-invite',        'link-invite@test.local'),
  ('22222222-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000003', 'recovery_token',     'hash-recovery-61',   'link-recovery-61@test.local'),
  ('22222222-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000004', 'confirmation_token', 'hash-invite-61',     'link-invite-61@test.local'),
  ('22222222-0000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000005', 'recovery_token',     'hash-recovery-59',   'link-recovery-59@test.local'),
  ('22222222-0000-0000-0000-000000000006', '11111111-0000-0000-0000-000000000006', 'confirmation_token', 'hash-invite-59',     'link-invite-59@test.local'),
  ('22222222-0000-0000-0000-000000000007', '11111111-0000-0000-0000-000000000007', 'recovery_token',     'hash-recovery-null', 'link-recovery-null@test.local');

select ok(public.auth_link_is_valid('hash-recovery', 'recovery', 3600), 'valid recovery link');
select ok(public.auth_link_is_valid('hash-invite', 'invite', 3600), 'valid invite link');
select ok(not public.auth_link_is_valid('hash-unknown', 'recovery', 3600),
  'unknown hash (used, replaced or made up) is invalid');
select ok(not public.auth_link_is_valid('hash-recovery', 'invite', 3600), 'recovery hash asked as invite is invalid');
select ok(not public.auth_link_is_valid('hash-invite', 'recovery', 3600), 'invite hash asked as recovery is invalid');
select ok(not public.auth_link_is_valid('hash-recovery-61', 'recovery', 3600), 'recovery sent 61 min ago is expired');
select ok(not public.auth_link_is_valid('hash-invite-61', 'invite', 3600), 'invite sent 61 min ago is expired');
select ok(public.auth_link_is_valid('hash-recovery-59', 'recovery', 3600), 'recovery sent 59 min ago is valid');
select ok(public.auth_link_is_valid('hash-invite-59', 'invite', 3600), 'invite sent 59 min ago is valid');
select ok(not public.auth_link_is_valid('hash-recovery-null', 'recovery', 3600), 'null sent-at is invalid');
select ok(not public.auth_link_is_valid('hash-invite', 'signup', 3600), 'unknown type is invalid');

select ok(
  not has_function_privilege('anon', 'public.auth_link_is_valid(text, text, integer)', 'execute'),
  'anon cannot execute auth_link_is_valid'
);
select ok(
  not has_function_privilege('authenticated', 'public.auth_link_is_valid(text, text, integer)', 'execute'),
  'authenticated cannot execute auth_link_is_valid'
);
select ok(
  has_function_privilege('service_role', 'public.auth_link_is_valid(text, text, integer)', 'execute'),
  'service_role can execute auth_link_is_valid'
);

select * from finish();
rollback;
