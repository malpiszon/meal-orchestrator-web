-- S-02 (recency-annotated-plan): for each option of one plan, the most recent
-- earlier date the same meal was planned for the same user. Matching runs in
-- Postgres so the Worker stays within its CPU budget, and the function is
-- security invoker, so the caller's RLS limits both the plan and the history
-- to the caller's own rows.
--
-- Same meal: equal weekly_plans.provider and plan_meal_options.provider_meal_id.
-- Earlier: meal_date strictly before the option's meal_date, in any plan.
-- Planned = is_recommended until S-03: an option that was only offered does
-- not count. S-03 must switch the "planned" predicate (h.is_recommended) to
-- the user's saved choice.

create or replace function public.get_plan_recency(p_plan_id uuid)
returns table (option_id uuid, last_planned_on date)
language sql
stable
security invoker
set search_path = ''
as $$
  select o.id as option_id, max(h.meal_date) as last_planned_on
    from public.weekly_plans p
    join public.plan_meal_options o
      on o.plan_id = p.id
    join public.plan_meal_options h
      on h.user_id = o.user_id
     and h.provider_meal_id = o.provider_meal_id
     and h.is_recommended
     and h.meal_date < o.meal_date
    join public.weekly_plans hp
      on hp.id = h.plan_id
     and hp.user_id = p.user_id
     and hp.provider = p.provider
   where p.id = p_plan_id
   group by o.id;
$$;

revoke execute on function public.get_plan_recency(uuid) from public, anon;
grant execute on function public.get_plan_recency(uuid) to authenticated;
