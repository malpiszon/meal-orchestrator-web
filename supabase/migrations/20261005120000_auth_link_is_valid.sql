-- S-10 (expired-link-notice): tells whether an invitation or password-reset link can still be used,
-- without using it, so /auth/set-password can show "invalid or has expired" on open.
--
-- Mirrors the first two steps of GoTrue v2.197.0's verifyTokenHash: the auth.one_time_tokens row
-- lookup by hash and type, then the sent-at + lifetime check (confirmation_sent_at for invite,
-- recovery_sent_at for recovery). See context/changes/expired-link-notice/research.md.
-- It reads Supabase-managed tables (auth.one_time_tokens, auth.users), which may change on a
-- Supabase Auth upgrade. Read-only: it changes nothing. Unknown type, missing row, null sent-at
-- or an expired link → false.

create or replace function public.auth_link_is_valid(
  p_token_hash text,
  p_type text,
  p_lifetime_seconds integer
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from auth.one_time_tokens ott
      join auth.users u on u.id = ott.user_id
     where ott.token_hash = p_token_hash
       and (
         (p_type = 'invite' and ott.token_type = 'confirmation_token'
            and now() <= u.confirmation_sent_at + make_interval(secs => p_lifetime_seconds))
         or
         (p_type = 'recovery' and ott.token_type = 'recovery_token'
            and now() <= u.recovery_sent_at + make_interval(secs => p_lifetime_seconds))
       )
  );
$$;

revoke execute on function public.auth_link_is_valid(text, text, integer)
  from public, anon, authenticated;
grant execute on function public.auth_link_is_valid(text, text, integer)
  to service_role;
