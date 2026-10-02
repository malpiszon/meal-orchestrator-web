import type { SupabaseClient } from "@supabase/supabase-js";
import type { WeeklyPlan } from "@/types";

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
    // raw_payload is not needed for display and is the bulk of the row.
    .select("id, provider, week_start, week_end, received_at, plan_meal_options(*)")
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
