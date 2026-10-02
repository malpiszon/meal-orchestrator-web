-- ingest_weekly_plan: look the user up through auth.users' email index instead of scanning the table.
-- GoTrue stores emails lowercased, so `email = lower(p_email)` matches what `lower(email) = lower(p_email)` did;
-- `is_sso_user = false` is the predicate of the partial unique index users_email_partial_key (mo-web has no SSO users).
-- Body otherwise unchanged from 20261001120000_weekly_plans.sql.

create or replace function public.ingest_weekly_plan(
  p_email text,
  p_provider text,
  p_week_start date,
  p_week_end date,
  p_run_id text,
  p_raw jsonb,
  p_options jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_plan_id uuid;
begin
  select u.id
    into v_user_id
    from auth.users u
   where u.email = lower(p_email)
     and u.is_sso_user = false
   limit 1;

  if v_user_id is null then
    raise exception using errcode = 'P0002', message = 'unknown_user';
  end if;

  insert into public.weekly_plans as wp
    (user_id, provider, week_start, week_end, mo_run_id, raw_payload, received_at)
  values
    (v_user_id, p_provider, p_week_start, p_week_end, p_run_id, p_raw, now())
  on conflict (user_id, week_start) do update
    set provider = excluded.provider,
        week_end = excluded.week_end,
        mo_run_id = excluded.mo_run_id,
        raw_payload = excluded.raw_payload,
        received_at = excluded.received_at
  returning wp.id into v_plan_id;

  delete from public.plan_meal_options where plan_id = v_plan_id;

  insert into public.plan_meal_options
    (plan_id, user_id, meal_date, meal_type, variant_index, provider_meal_id,
     name, composition, nutrition, score, justifications, is_recommended)
  select
    v_plan_id, v_user_id, o.meal_date, o.meal_type, o.variant_index, o.provider_meal_id,
    o.name, o.composition, o.nutrition, o.score, coalesce(o.justifications, '[]'::jsonb), o.is_recommended
  from jsonb_to_recordset(p_options) as o(
    meal_date date,
    meal_type text,
    variant_index smallint,
    provider_meal_id text,
    name text,
    composition text,
    nutrition jsonb,
    score smallint,
    justifications jsonb,
    is_recommended boolean
  );

  return v_plan_id;
end;
$$;

revoke execute on function public.ingest_weekly_plan(text, text, date, date, text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.ingest_weekly_plan(text, text, date, date, text, jsonb, jsonb)
  to service_role;
