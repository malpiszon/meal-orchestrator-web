import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays } from "@/lib/plans";
import type { WeeklyPlan } from "@/types";

// raw_payload is not needed for display and is the bulk of the row.
const PLAN_SELECT = "id, provider, week_start, week_end, received_at, plan_meal_options(*)";

/**
 * The signed-in user's upcoming plan: the latest `weekly_plans` row with `week_start > today`
 * (`today` from `todayInWarsaw`), with its options. Pass the user's cookie-session client, so RLS
 * limits the read to the user's own rows; the explicit `user_id` filter is defence in depth.
 * Returns `null` when there is none; throws on a query error.
 */
export async function getUpcomingPlan(
  supabase: SupabaseClient,
  userId: string,
  today: string,
): Promise<WeeklyPlan | null> {
  const { data, error } = await supabase
    .from("weekly_plans")
    .select(PLAN_SELECT)
    // Defence in depth on top of RLS.
    .eq("user_id", userId)
    .gt("week_start", today)
    .order("week_start", { ascending: false })
    .limit(1)
    .maybeSingle<WeeklyPlan>();

  if (error) {
    throw new Error(`weekly_plans query failed: ${error.code} ${error.message}`);
  }
  return data;
}

/**
 * The signed-in user's plan for the week in progress: the latest `weekly_plans` row with
 * `today - 7 days < week_start <= today` (`today` from `todayInWarsaw`), with its options. Same client,
 * defence-in-depth and error conventions as `getUpcomingPlan`. Returns `null` when there is none.
 */
export async function getCurrentPlan(
  supabase: SupabaseClient,
  userId: string,
  today: string,
): Promise<WeeklyPlan | null> {
  const { data, error } = await supabase
    .from("weekly_plans")
    .select(PLAN_SELECT)
    // Defence in depth on top of RLS.
    .eq("user_id", userId)
    .lte("week_start", today)
    .gt("week_start", addDays(today, -7))
    .order("week_start", { ascending: false })
    .limit(1)
    .maybeSingle<WeeklyPlan>();

  if (error) {
    throw new Error(`weekly_plans query failed: ${error.code} ${error.message}`);
  }
  return data;
}

/** A row returned by `public.get_plan_recency`. */
interface PlanRecencyRow {
  option_id: string;
  last_planned_on: string;
}

/**
 * For each option of plan `planId` that was planned earlier, the most recent earlier planned date:
 * option id → `YYYY-MM-DD`. Computed by `public.get_plan_recency` (security invoker, so the user's
 * cookie-session client keeps RLS on both the plan and the history). Options without an earlier
 * planned occurrence are absent. Throws on an RPC error.
 */
export async function getPlanRecency(supabase: SupabaseClient, planId: string): Promise<Map<string, string>> {
  const result = await supabase.rpc("get_plan_recency", { p_plan_id: planId });

  if (result.error) {
    throw new Error(`get_plan_recency failed: ${result.error.code} ${result.error.message}`);
  }
  // The client is untyped (no generated database types), so the row shape is asserted here.
  const rows = (result.data ?? []) as PlanRecencyRow[];
  return new Map(rows.map((row) => [row.option_id, row.last_planned_on]));
}
