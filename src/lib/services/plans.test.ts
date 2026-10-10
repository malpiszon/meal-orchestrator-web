import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getCurrentPlan, getPastPlan, getPastPlans, getUpcomingPlan } from "@/lib/services/plans";
import { addDays } from "@/lib/plans";
import { fakeSupabase, type Row } from "@/test/fake-supabase";

const ME = "user-me";
const OTHER = "user-other";

// A weekly_plans row of `userId` starting at `weekStart`, as PostgREST would return it.
function week(userId: string, weekStart: string): Row {
  return {
    id: `${userId}-${weekStart}`,
    user_id: userId,
    provider: "ntfy",
    week_start: weekStart,
    week_end: addDays(weekStart, 4),
    received_at: `${weekStart}T00:00:00Z`,
    saved_at: null,
    plan_meal_options: [],
  };
}

// The signed-in user's weeks plus another user's weeks that would win every selection without the
// user_id filter (nearer upcoming, later current, newer past).
function client(myWeeks: string[], otherWeeks: string[] = []): SupabaseClient {
  return fakeSupabase({
    weekly_plans: [...otherWeeks.map((start) => week(OTHER, start)), ...myWeeks.map((start) => week(ME, start))],
  });
}

const id = (weekStart: string) => `${ME}-${weekStart}`;

describe("week selection (docs/api.md, Weeks on the dashboard and in history)", () => {
  describe("today 2026-10-14 (Wednesday), weeks 09-28, 10-05, 10-12, 10-19, 10-26", () => {
    const today = "2026-10-14";
    const supabase = client(
      ["2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"],
      ["2026-10-06", "2026-10-13", "2026-10-15"],
    );

    it("Next week is the nearest future week, not the latest", async () => {
      expect((await getUpcomingPlan(supabase, ME, today))?.id).toBe(id("2026-10-19"));
    });

    it("This week is the week in progress", async () => {
      expect((await getCurrentPlan(supabase, ME, today))?.id).toBe(id("2026-10-12"));
    });

    it("history lists the past weeks, newest first", async () => {
      const past = await getPastPlans(supabase, ME, today);
      expect(past.map((plan) => plan.id)).toEqual([id("2026-10-05"), id("2026-09-28")]);
    });

    it("a past week opens; the current and upcoming weeks don't", async () => {
      expect(await getPastPlan(supabase, ME, id("2026-10-12"), today)).toBeNull();
      expect(await getPastPlan(supabase, ME, id("2026-10-19"), today)).toBeNull();
      expect((await getPastPlan(supabase, ME, id("2026-10-05"), today))?.id).toBe(id("2026-10-05"));
    });
  });

  describe("today 2026-10-19 (Monday)", () => {
    const today = "2026-10-19";

    it("the week starting today is This week and the next one is Next week", async () => {
      const supabase = client(["2026-10-12", "2026-10-19", "2026-10-26"], ["2026-10-20"]);
      expect((await getCurrentPlan(supabase, ME, today))?.id).toBe(id("2026-10-19"));
      expect((await getUpcomingPlan(supabase, ME, today))?.id).toBe(id("2026-10-26"));
    });

    it("the week that started 7 days ago is history only", async () => {
      const supabase = client(["2026-10-12", "2026-10-26"]);
      expect(await getCurrentPlan(supabase, ME, today)).toBeNull();
      expect((await getPastPlans(supabase, ME, today)).map((plan) => plan.id)).toEqual([id("2026-10-12")]);
      expect((await getPastPlan(supabase, ME, id("2026-10-12"), today))?.id).toBe(id("2026-10-12"));
    });

    it("a week that started 6 days ago is This week, not history", async () => {
      const supabase = client(["2026-10-12", "2026-10-13"]);
      expect((await getCurrentPlan(supabase, ME, today))?.id).toBe(id("2026-10-13"));
      expect((await getPastPlans(supabase, ME, today)).map((plan) => plan.id)).toEqual([id("2026-10-12")]);
    });
  });

  it("without a future week, Next week is empty", async () => {
    const supabase = client(["2026-09-28", "2026-10-05"], ["2026-10-19"]);
    expect(await getUpcomingPlan(supabase, ME, "2026-10-14")).toBeNull();
  });

  it("never returns another user's week", async () => {
    const today = "2026-10-14";
    const supabase = client(["2026-10-26"], ["2026-10-19", "2026-10-12", "2026-10-05"]);
    expect((await getUpcomingPlan(supabase, ME, today))?.id).toBe(id("2026-10-26"));
    expect(await getCurrentPlan(supabase, ME, today)).toBeNull();
    expect(await getPastPlans(supabase, ME, today)).toEqual([]);
    expect(await getPastPlan(supabase, ME, `${OTHER}-2026-10-05`, today)).toBeNull();
  });
});

describe("getUpcomingPlan", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("retries PGRST303 'JWT issued at future' with a new query and returns the plan", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const plan = { id: "plan-1" };
    const results = [
      { data: null, error: { code: "PGRST303", message: "JWT issued at future" } },
      { data: plan, error: null },
    ];
    // Each `from()` starts a new builder chain that resolves to the next scripted result.
    const from = vi.fn(() => {
      const result = results[from.mock.calls.length - 1];
      const builder = {
        select: () => builder,
        eq: () => builder,
        gt: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: () => Promise.resolve(result),
      };
      return builder;
    });
    const supabase = { from } as unknown as SupabaseClient;

    const loading = getUpcomingPlan(supabase, "user-1", "2026-10-04");
    await vi.advanceTimersByTimeAsync(500);

    await expect(loading).resolves.toBe(plan);
    expect(from).toHaveBeenCalledTimes(2);
  });
});
