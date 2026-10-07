-- Recency counts saved plans only (context/changes/recency-from-saved-plans/plan.md).
--
-- Rule: a meal counts as "planned" only when it is the chosen option (is_chosen) of a plan that has been
-- saved (weekly_plans.saved_at is not null). Why: first user feedback showed recency notes pointing at
-- plans the user never looked at or confirmed, so MO's untouched recommendations were treated as meals
-- the user had actually planned.
--
-- Consequences:
-- - A plan that was never saved gives no notes, including a week that has since started and can no longer
--   be edited or saved (choose_plan_option and confirm_plan refuse it): it never becomes history.
-- - The plan being annotated may itself be the history source for its later days, but only once it is saved.
-- - No backfill is needed: the function reads saved_at at call time, so existing data is judged by the
--   new rule at once.
--
-- Same signature and privileges as in 20261003120000_plan_choices.sql; only `hp.saved_at is not null` is added.
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
     and h.is_chosen
     and h.meal_date < o.meal_date
    join public.weekly_plans hp
      on hp.id = h.plan_id
     and hp.user_id = p.user_id
     and hp.provider = p.provider
     and hp.saved_at is not null
   where p.id = p_plan_id
   group by o.id;
$$;

revoke execute on function public.get_plan_recency(uuid) from public, anon;
grant execute on function public.get_plan_recency(uuid) to authenticated;
