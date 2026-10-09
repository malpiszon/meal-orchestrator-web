import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getUpcomingPlan } from "@/lib/services/plans";

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

  it("selects the nearest future week, not the latest", async () => {
    const gt = vi.fn();
    const order = vi.fn();
    const builder = {
      select: () => builder,
      eq: () => builder,
      gt: (...args: unknown[]) => {
        gt(...args);
        return builder;
      },
      order: (...args: unknown[]) => {
        order(...args);
        return builder;
      },
      limit: () => builder,
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
    };
    const supabase = { from: () => builder } as unknown as SupabaseClient;

    await expect(getUpcomingPlan(supabase, "user-1", "2026-10-04")).resolves.toBeNull();

    expect(gt).toHaveBeenCalledWith("week_start", "2026-10-04");
    expect(order).toHaveBeenCalledWith("week_start", { ascending: true });
  });
});
