import { describe, expect, it } from "vitest";
import { formatDayLabel, formatWeekRange, groupPlanOptions, mealTypeLabel, todayInWarsaw } from "@/lib/plans";
import { MEAL_TYPES } from "@/types";

describe("todayInWarsaw", () => {
  it("2026-10-04T22:30:00Z is 2026-10-05 in Warsaw (summer time, UTC+2: 00:30)", () => {
    expect(todayInWarsaw(new Date("2026-10-04T22:30:00Z"))).toBe("2026-10-05");
  });

  it("2026-10-04T21:30:00Z is still 2026-10-04 in Warsaw (summer time, UTC+2: 23:30)", () => {
    expect(todayInWarsaw(new Date("2026-10-04T21:30:00Z"))).toBe("2026-10-04");
  });

  // Summer time ends on Sunday 2026-10-25 at 01:00 UTC (03:00 CEST -> 02:00 CET).
  it("before the DST switch: 2026-10-24T22:30:00Z is 2026-10-25 (UTC+2: 00:30)", () => {
    expect(todayInWarsaw(new Date("2026-10-24T22:30:00Z"))).toBe("2026-10-25");
  });

  it("after the DST switch: 2026-10-25T22:30:00Z is still 2026-10-25 (winter time, UTC+1: 23:30)", () => {
    expect(todayInWarsaw(new Date("2026-10-25T22:30:00Z"))).toBe("2026-10-25");
  });

  it("after the DST switch: 2026-10-25T23:30:00Z is 2026-10-26 (winter time, UTC+1: 00:30)", () => {
    expect(todayInWarsaw(new Date("2026-10-25T23:30:00Z"))).toBe("2026-10-26");
  });

  it("pads month and day: 2026-01-04T23:00:00Z is 2026-01-05 (winter time, UTC+1: 00:00)", () => {
    expect(todayInWarsaw(new Date("2026-01-04T23:00:00Z"))).toBe("2026-01-05");
  });
});

interface Row {
  meal_date: string;
  meal_type: string;
  variant_index: number;
  score: number;
  is_recommended: boolean;
}

function row(meal_date: string, meal_type: string, variant_index: number, score: number, is_recommended = false): Row {
  return { meal_date, meal_type, variant_index, score, is_recommended };
}

describe("groupPlanOptions", () => {
  it("orders days by date and slots by MO's slot order", () => {
    const rows = [
      row("2026-10-06", "lunch", 0, 5, true),
      row("2026-10-05", "snack", 0, 5, true),
      row("2026-10-05", "breakfast", 0, 5, true),
      row("2026-10-05", "second_breakfast", 0, 5, true),
      row("2026-10-06", "breakfast", 0, 5, true),
      row("2026-10-05", "dinner", 0, 5, true),
      row("2026-10-05", "tea", 0, 5, true),
      row("2026-10-05", "lunch", 0, 5, true),
    ];

    const days = groupPlanOptions(rows);

    expect(days.map((day) => day.date)).toEqual(["2026-10-05", "2026-10-06"]);
    expect(days[0].slots.map((slot) => slot.mealType)).toEqual([...MEAL_TYPES]);
    expect(days[1].slots.map((slot) => slot.mealType)).toEqual(["breakfast", "lunch"]);
  });

  it("puts the recommended option apart and sorts the others by score descending, then index", () => {
    const rows = [
      row("2026-10-05", "lunch", 0, 6),
      row("2026-10-05", "lunch", 1, 9),
      row("2026-10-05", "lunch", 2, 8, true),
      row("2026-10-05", "lunch", 3, 9),
      row("2026-10-05", "lunch", 4, 6),
    ];

    const [slot] = groupPlanOptions(rows)[0].slots;

    expect(slot.recommended).toBe(rows[2]);
    expect(slot.others.map((option) => option.variant_index)).toEqual([1, 3, 0, 4]);
  });

  it("shows the stored recommendation even when the score/index fallback would pick another option", () => {
    // Index 1 is flagged although index 0 ties on score: the stored flag wins, not the fallback.
    const rows = [row("2026-10-05", "breakfast", 0, 9), row("2026-10-05", "breakfast", 1, 9, true)];

    const [slot] = groupPlanOptions(rows)[0].slots;

    expect(slot.recommended.variant_index).toBe(1);
    expect(slot.others.map((option) => option.variant_index)).toEqual([0]);
  });

  it("falls back to the highest score, lowest index when no option is recommended", () => {
    const rows = [row("2026-10-05", "tea", 0, 4), row("2026-10-05", "tea", 2, 7), row("2026-10-05", "tea", 1, 7)];

    const [slot] = groupPlanOptions(rows)[0].slots;

    expect(slot.recommended.variant_index).toBe(1);
    expect(slot.others.map((option) => option.variant_index)).toEqual([2, 0]);
  });

  it("skips rows whose meal type is unknown", () => {
    const rows = [row("2026-10-05", "brunch", 0, 9, true), row("2026-10-05", "dinner", 0, 5, true)];

    const days = groupPlanOptions(rows);

    expect(days[0].slots.map((slot) => slot.mealType)).toEqual(["dinner"]);
  });

  it("returns no days for no rows", () => {
    expect(groupPlanOptions([])).toEqual([]);
  });
});

describe("labels", () => {
  it("derives human meal-type labels", () => {
    expect(mealTypeLabel("second_breakfast")).toBe("Second breakfast");
    expect(mealTypeLabel("tea")).toBe("Tea");
  });

  it("formats a calendar date as weekday and date, independent of the runtime timezone (tests run in UTC-10)", () => {
    expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(600);
    expect(formatDayLabel("2026-10-05")).toBe("Monday 5 October");
    expect(formatDayLabel("2026-10-25")).toBe("Sunday 25 October");
  });

  it("formats the week range", () => {
    expect(formatWeekRange("2026-10-05", "2026-10-09")).toBe("5–9 October 2026");
    expect(formatWeekRange("2026-09-28", "2026-10-02")).toBe("28 September – 2 October 2026");
    expect(formatWeekRange("2026-12-28", "2027-01-01")).toBe("28 December 2026 – 1 January 2027");
  });
});
