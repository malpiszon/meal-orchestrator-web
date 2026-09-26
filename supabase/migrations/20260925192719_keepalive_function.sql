-- F-02: side-effect-free function pinged by a daily Cloudflare Cron Trigger
-- so each run executes a real Postgres query, preventing the free-tier
-- project from pausing after ~7 days of inactivity.

create or replace function public.keepalive()
returns timestamptz
language sql
stable
security invoker
set search_path = ''
as $$
  select now();
$$;

revoke execute on function public.keepalive() from public;
grant execute on function public.keepalive() to anon, authenticated;
