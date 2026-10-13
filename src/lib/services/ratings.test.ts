import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { getPlanRatings, rateMeal, RatingWriteError, ratingWriteErrorKind } from "@/lib/services/ratings";

describe("ratingWriteErrorKind", () => {
  it("maps rate_meal's deliberate errors", () => {
    expect(ratingWriteErrorKind({ code: "P0002", message: "not_found" })).toBe("not_found");
    expect(ratingWriteErrorKind({ code: "55000", message: "not_rateable" })).toBe("not_rateable");
  });

  it("maps anything else to failed", () => {
    expect(ratingWriteErrorKind({ code: "23514", message: "check constraint violation" })).toBe("failed");
    expect(ratingWriteErrorKind({ code: "P0002", message: "no rows" })).toBe("failed");
    expect(ratingWriteErrorKind({ message: "network" })).toBe("failed");
  });
});

describe("errors keep the Supabase error as cause", () => {
  const supabaseError = { code: "57014", message: "canceling statement due to statement timeout", hint: null };
  const supabase = {
    rpc: () => Promise.resolve({ data: null, error: supabaseError }),
  } as unknown as SupabaseClient;

  it("on a read", async () => {
    const failure = await getPlanRatings(supabase, "plan-1").catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(
      "get_plan_ratings failed: 57014 canceling statement due to statement timeout",
    );
    expect((failure as Error).cause).toBe(supabaseError);
  });

  it("on a write", async () => {
    const failure = await rateMeal(supabase, "option-1", 4).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(RatingWriteError);
    expect((failure as RatingWriteError).kind).toBe("failed");
    expect((failure as RatingWriteError).cause).toBe(supabaseError);
  });
});
