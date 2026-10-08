import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays } from "@/lib/plans";
import { withPgrst303Retry } from "@/lib/postgrest-retry";
import type { PastPlanSummary, WeeklyPlan } from "@/types";

// raw_payload is not needed for display and is the bulk of the row. Each option embeds the user's own
// rating (RLS on `meal_ratings`); `option_id` is its primary key, so PostgREST returns an object or `null`.
const PLAN_SELECT =
  "id, provider, week_start, week_end, received_at, saved_at, plan_meal_options(*, meal_ratings(rating))";

/**
 * The signed-in user's upcoming plan: the nearest `weekly_plans` row with `week_start > today`
 * (`today` from `todayInWarsaw`), with its options. A later future week stays hidden until the nearer
 * one starts, so the week with the earliest edit deadline is the one shown. Pass the user's cookie-session client, so RLS
 * limits the read to the user's own rows; the explicit `user_id` filter is defence in depth.
 * Returns `null` when there is none; throws on a query error. Retries PGRST303 "JWT issued at future"
 * first (see `withPgrst303Retry`).
 */
export async function getUpcomingPlan(
  supabase: SupabaseClient,
  userId: string,
  today: string,
): Promise<WeeklyPlan | null> {
  const { data, error } = await withPgrst303Retry("weekly_plans query", () =>
    supabase
      .from("weekly_plans")
      .select(PLAN_SELECT)
      // Defence in depth on top of RLS.
      .eq("user_id", userId)
      .gt("week_start", today)
      .order("week_start", { ascending: true })
      .limit(1)
      .maybeSingle<WeeklyPlan>(),
  );

  if (error) {
    throw new Error(`weekly_plans query failed: ${error.code} ${error.message}`);
  }
  return data;
}

/**
 * The signed-in user's plan for the week in progress: the latest `weekly_plans` row with
 * `today - 7 days < week_start <= today` (`today` from `todayInWarsaw`), with its options. Same client,
 * defence-in-depth, error and retry conventions as `getUpcomingPlan`. Returns `null` when there is none.
 */
export async function getCurrentPlan(
  supabase: SupabaseClient,
  userId: string,
  today: string,
): Promise<WeeklyPlan | null> {
  const { data, error } = await withPgrst303Retry("weekly_plans query", () =>
    supabase
      .from("weekly_plans")
      .select(PLAN_SELECT)
      // Defence in depth on top of RLS.
      .eq("user_id", userId)
      .lte("week_start", today)
      .gt("week_start", addDays(today, -7))
      .order("week_start", { ascending: false })
      .limit(1)
      .maybeSingle<WeeklyPlan>(),
  );

  if (error) {
    throw new Error(`weekly_plans query failed: ${error.code} ${error.message}`);
  }
  return data;
}

/**
 * The signed-in user's past weeks, newest first: every `weekly_plans` row with
 * `week_start <= today - 7 days` (`today` from `todayInWarsaw`, the complement of `getCurrentPlan`'s bound),
 * without options. Same client, defence-in-depth, error and retry conventions as `getUpcomingPlan`.
 * Returns `[]` when there are none.
 */
export async function getPastPlans(
  supabase: SupabaseClient,
  userId: string,
  today: string,
): Promise<PastPlanSummary[]> {
  const { data, error } = await withPgrst303Retry("weekly_plans query", () =>
    supabase
      .from("weekly_plans")
      .select("id, week_start, week_end, saved_at")
      // Defence in depth on top of RLS.
      .eq("user_id", userId)
      .lte("week_start", addDays(today, -7))
      .order("week_start", { ascending: false }),
  );

  if (error) {
    throw new Error(`weekly_plans query failed: ${error.code} ${error.message}`);
  }
  // The client is untyped (no generated database types): the rows are the four selected columns.
  return data;
}

/**
 * One past week of the signed-in user, with its options: plan `planId` if it is the user's and its
 * `week_start <= today - 7 days` (as `getPastPlans`). Same conventions as `getUpcomingPlan`. Returns
 * `null` when no row matches, which covers unknown, someone else's, current and upcoming plans.
 */
export async function getPastPlan(
  supabase: SupabaseClient,
  userId: string,
  planId: string,
  today: string,
): Promise<WeeklyPlan | null> {
  const { data, error } = await withPgrst303Retry("weekly_plans query", () =>
    supabase
      .from("weekly_plans")
      .select(PLAN_SELECT)
      .eq("id", planId)
      // Defence in depth on top of RLS.
      .eq("user_id", userId)
      .lte("week_start", addDays(today, -7))
      .maybeSingle<WeeklyPlan>(),
  );

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
 * planned occurrence are absent. Throws on an RPC error, after retrying PGRST303 "JWT issued at future"
 * (see `withPgrst303Retry`).
 */
export async function getPlanRecency(supabase: SupabaseClient, planId: string): Promise<Map<string, string>> {
  const result = await withPgrst303Retry("get_plan_recency", () =>
    supabase.rpc("get_plan_recency", { p_plan_id: planId }),
  );

  if (result.error) {
    throw new Error(`get_plan_recency failed: ${result.error.code} ${result.error.message}`);
  }
  // The client is untyped (no generated database types), so the row shape is asserted here.
  const rows = (result.data ?? []) as PlanRecencyRow[];
  return new Map(rows.map((row) => [row.option_id, row.last_planned_on]));
}

/** Why a plan write failed: the option/plan is missing or not the user's, the week has started, or anything else. */
export type PlanWriteErrorKind = "not_found" | "plan_locked" | "failed";

/** Thrown by `choosePlanOption` and `confirmPlan`. `message` carries the Postgres code and message only. */
export class PlanWriteError extends Error {
  readonly kind: PlanWriteErrorKind;

  constructor(kind: PlanWriteErrorKind, message: string) {
    super(message);
    this.name = "PlanWriteError";
    this.kind = kind;
  }
}

interface RpcError {
  code?: string;
  message: string;
}

// The errors `choose_plan_option` / `confirm_plan` raise on purpose (see 20261003120000_plan_choices.sql).
function planWriteErrorKind(error: RpcError): PlanWriteErrorKind {
  if (error.code === "P0002" && error.message === "not_found") return "not_found";
  if (error.code === "55000" && error.message === "plan_locked") return "plan_locked";
  return "failed";
}

/**
 * Runs `fn` and returns its new `saved_at`; throws a `PlanWriteError`. Retries PGRST303 "JWT issued
 * at future" first (see `withPgrst303Retry`): PostgREST raises it before any SQL runs, so a retry
 * can't apply the write twice.
 */
async function savePlan(
  supabase: SupabaseClient,
  fn: "choose_plan_option" | "confirm_plan",
  args: Record<string, string>,
): Promise<{ savedAt: string }> {
  const result = await withPgrst303Retry(fn, () => supabase.rpc(fn, args));

  if (result.error) {
    throw new PlanWriteError(
      planWriteErrorKind(result.error),
      `${fn} failed: ${result.error.code} ${result.error.message}`,
    );
  }
  // The client is untyped (no generated database types): the function returns the new saved_at.
  const savedAt: unknown = result.data;
  if (typeof savedAt !== "string") {
    throw new PlanWriteError("failed", `${fn} failed: returned no saved_at`);
  }
  return { savedAt };
}

/**
 * Make option `optionId` the chosen option of its slot and mark its plan saved, through
 * `public.choose_plan_option` (security definer; it checks the option's owner and the cut-off).
 * Pass the user's cookie-session client. Returns the new `saved_at`; throws a `PlanWriteError`.
 */
export function choosePlanOption(supabase: SupabaseClient, optionId: string): Promise<{ savedAt: string }> {
  return savePlan(supabase, "choose_plan_option", { p_option_id: optionId });
}

/**
 * Mark plan `planId` saved without changing any choice, through `public.confirm_plan` (same checks
 * as `choosePlanOption`). Pass the user's cookie-session client. Returns the new `saved_at`; throws a
 * `PlanWriteError`.
 */
export function confirmPlan(supabase: SupabaseClient, planId: string): Promise<{ savedAt: string }> {
  return savePlan(supabase, "confirm_plan", { p_plan_id: planId });
}
