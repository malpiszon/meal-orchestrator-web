-- S-13 (rating-ordered-options): one-time re-pick of the plans stored before 20261008180000, so their
-- stored choice is the suggested pick the dashboard now lists first and stars
-- (context/changes/rating-ordered-options/plan.md).
--
-- Every plan that is not saved (saved_at is null) and has not started (week_start after today in
-- Europe/Warsaw) gets its chosen rows cleared and every slot re-picked by pick_default_choices, as
-- rate_meal does for the caller's plans. Saved plans and started weeks keep their choices. Plans are
-- locked in week_start, id order, as rate_meal locks them, and re-checked under the lock.
do $$
declare
  v_today date := (now() at time zone 'Europe/Warsaw')::date;
  v_plan_ids uuid[];
  v_plan_id uuid;
begin
  select coalesce(array_agg(l.id), '{}')
    into v_plan_ids
    from (
      select p.id
        from public.weekly_plans p
       where p.saved_at is null
         and p.week_start > v_today
       order by p.week_start, p.id
         for update
    ) as l;

  foreach v_plan_id in array v_plan_ids loop
    continue when not exists (
      select 1
        from public.weekly_plans p
       where p.id = v_plan_id
         and p.saved_at is null
         and p.week_start > v_today
    );

    update public.plan_meal_options
       set is_chosen = false
     where plan_id = v_plan_id
       and is_chosen;

    perform public.pick_default_choices(v_plan_id);
  end loop;
end;
$$;
