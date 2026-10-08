import type { SupabaseClient } from "@supabase/supabase-js";
import { withPgrst303Retry } from "@/lib/postgrest-retry";

/** Why a rating write failed: the option is missing or not the user's, it can't be rated (not chosen or outside the window), or anything else. */
export type RatingWriteErrorKind = "not_found" | "not_rateable" | "failed";

/** Thrown by `rateMeal`. `message` carries the Postgres code and message only. */
export class RatingWriteError extends Error {
  readonly kind: RatingWriteErrorKind;

  constructor(kind: RatingWriteErrorKind, message: string) {
    super(message);
    this.name = "RatingWriteError";
    this.kind = kind;
  }
}

interface RpcError {
  code?: string;
  message: string;
}

// The errors `rate_meal` raises on purpose (see 20261008120000_meal_ratings.sql).
export function ratingWriteErrorKind(error: RpcError): RatingWriteErrorKind {
  if (error.code === "P0002" && error.message === "not_found") return "not_found";
  if (error.code === "55000" && error.message === "not_rateable") return "not_rateable";
  return "failed";
}

/**
 * Store `rating` (1-5) as the user's rating of the chosen option `optionId`, or clear it when `rating`
 * is `null`, through `public.rate_meal` (security definer; it checks the option's owner, that it is
 * chosen and the rateable window). Pass the user's cookie-session client. Returns the stored rating, or
 * `null` after a clear; throws a `RatingWriteError`. Retries PGRST303 "JWT issued at future" first
 * (see `withPgrst303Retry`): PostgREST raises it before any SQL runs, so a retry can't apply the write twice.
 */
export async function rateMeal(
  supabase: SupabaseClient,
  optionId: string,
  rating: number | null,
): Promise<number | null> {
  const result = await withPgrst303Retry("rate_meal", () =>
    supabase.rpc("rate_meal", { p_option_id: optionId, p_rating: rating }),
  );

  if (result.error) {
    throw new RatingWriteError(
      ratingWriteErrorKind(result.error),
      `rate_meal failed: ${result.error.code} ${result.error.message}`,
    );
  }
  // The client is untyped (no generated database types): the function returns the stored rating or null.
  const stored: unknown = result.data;
  if (stored !== null && typeof stored !== "number") {
    throw new RatingWriteError("failed", "rate_meal failed: returned no rating");
  }
  return stored;
}

/** A row returned by `public.get_plan_ratings`. */
interface PlanRatingRow {
  option_id: string;
  rating: number;
}

/**
 * For each option of plan `planId` whose meal was rated on an earlier day, the latest such rating:
 * option id → 1-5. Computed by `public.get_plan_ratings` (security invoker, so the user's cookie-session
 * client keeps RLS on the plan, the history and the ratings). Options without an earlier rating are
 * absent. Throws on an RPC error, after retrying PGRST303 "JWT issued at future" (see `withPgrst303Retry`).
 */
export async function getPlanRatings(supabase: SupabaseClient, planId: string): Promise<Map<string, number>> {
  const result = await withPgrst303Retry("get_plan_ratings", () =>
    supabase.rpc("get_plan_ratings", { p_plan_id: planId }),
  );

  if (result.error) {
    throw new Error(`get_plan_ratings failed: ${result.error.code} ${result.error.message}`);
  }
  // The client is untyped (no generated database types), so the row shape is asserted here.
  const rows = (result.data ?? []) as PlanRatingRow[];
  return new Map(rows.map((row) => [row.option_id, row.rating]));
}
