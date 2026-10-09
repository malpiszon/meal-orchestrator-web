import { describe, expect, it } from "vitest";
import {
  addDays,
  adjustedScore,
  formatDayLabel,
  formatEditableUntil,
  formatPlanSavedStatus,
  formatRecency,
  formatSavedAt,
  formatWeekRange,
  groupPlanOptions,
  mealTypeLabel,
  todayInWarsaw,
} from "@/lib/plans";
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
  id: string;
  meal_date: string;
  meal_type: string;
  variant_index: number;
  score: number;
  is_recommended: boolean;
  is_chosen: boolean;
}

function row(
  meal_date: string,
  meal_type: string,
  variant_index: number,
  score: number,
  is_recommended = false,
  is_chosen = false,
): Row {
  const id = `${meal_date}/${meal_type}/${variant_index}`;
  return { id, meal_date, meal_type, variant_index, score, is_recommended, is_chosen };
}

describe("adjustedScore", () => {
  it.each([
    [5, 107],
    [4, 9],
    [3, 7],
    [2, 5],
    [1, -93],
    [undefined, 7],
  ])("maps a 7/10 rated %s to %i", (rating, expected) => {
    expect(adjustedScore(7, rating)).toBe(expected);
  });
});

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

  it("puts the chosen option apart and sorts the others by score descending, then index", () => {
    const rows = [
      row("2026-10-05", "lunch", 0, 6),
      row("2026-10-05", "lunch", 1, 9),
      row("2026-10-05", "lunch", 2, 8, true, true),
      row("2026-10-05", "lunch", 3, 9),
      row("2026-10-05", "lunch", 4, 6),
    ];

    const [slot] = groupPlanOptions(rows)[0].slots;

    expect(slot.chosen).toBe(rows[2]);
    expect(slot.others.map((option) => option.variant_index)).toEqual([1, 3, 0, 4]);
  });

  it("falls back to the first option (highest score, lowest index) when none is chosen, ignoring is_recommended", () => {
    const rows = [row("2026-10-05", "tea", 0, 4, true), row("2026-10-05", "tea", 2, 7), row("2026-10-05", "tea", 1, 7)];

    const [slot] = groupPlanOptions(rows)[0].slots;

    expect(slot.chosen.variant_index).toBe(1);
    expect(slot.others.map((option) => option.variant_index)).toEqual([2, 0]);
  });

  it("prefers the chosen option over the recommended one and the best one", () => {
    const rows = [
      row("2026-10-05", "lunch", 0, 9),
      row("2026-10-05", "lunch", 1, 8, true),
      row("2026-10-05", "lunch", 2, 6, false, true),
    ];

    const [slot] = groupPlanOptions(rows)[0].slots;

    expect(slot.chosen).toBe(rows[2]);
    expect(slot.others.map((option) => option.variant_index)).toEqual([0, 1]);
  });

  it("lists every option best first, whichever one is chosen", () => {
    const recommended = [
      row("2026-10-05", "dinner", 0, 6),
      row("2026-10-05", "dinner", 1, 9, true, true),
      row("2026-10-05", "dinner", 2, 7),
    ];
    const swapped = [
      row("2026-10-05", "dinner", 0, 6, false, true),
      row("2026-10-05", "dinner", 1, 9, true),
      row("2026-10-05", "dinner", 2, 7),
    ];

    const [before] = groupPlanOptions(recommended)[0].slots;
    const [after] = groupPlanOptions(swapped)[0].slots;

    expect(before.options.map((option) => option.variant_index)).toEqual([1, 2, 0]);
    expect(after.options.map((option) => option.variant_index)).toEqual([1, 2, 0]);
    expect(after.chosen.variant_index).toBe(0);
  });

  it("stars every option with the slot's highest score when there are no ratings", () => {
    const rows = [
      row("2026-10-05", "snack", 0, 8, true, true),
      row("2026-10-05", "snack", 1, 8),
      row("2026-10-05", "snack", 2, 5),
    ];

    const [slot] = groupPlanOptions(rows)[0].slots;

    expect(slot.starredIds).toEqual([rows[0].id, rows[1].id]);
  });

  describe("with ratings", () => {
    it("lists a 1/5 recommended option last", () => {
      const rows = [
        row("2026-10-05", "lunch", 0, 9, true),
        row("2026-10-05", "lunch", 1, 7),
        row("2026-10-05", "lunch", 2, 5),
      ];

      const [slot] = groupPlanOptions(rows, new Map([[rows[0].id, 1]]))[0].slots;

      expect(slot.options.map((option) => option.variant_index)).toEqual([1, 2, 0]);
      expect(slot.chosen.variant_index).toBe(1);
      expect(slot.starredIds).toEqual([rows[1].id]);
    });

    it("lists a 5/5 low-score option first", () => {
      const rows = [
        row("2026-10-05", "lunch", 0, 9, true),
        row("2026-10-05", "lunch", 1, 7),
        row("2026-10-05", "lunch", 2, 3),
      ];

      const [slot] = groupPlanOptions(rows, new Map([[rows[2].id, 5]]))[0].slots;

      expect(slot.options.map((option) => option.variant_index)).toEqual([2, 0, 1]);
      expect(slot.starredIds).toEqual([rows[2].id]);
    });

    it("breaks an adjusted-score tie by MO score: A 9/10 unrated before B 7/10 rated 4/5, A alone starred", () => {
      const rows = [row("2026-10-05", "dinner", 1, 7), row("2026-10-05", "dinner", 0, 9, true)];

      const [slot] = groupPlanOptions(rows, new Map([[rows[0].id, 4]]))[0].slots;

      expect(slot.options.map((option) => option.variant_index)).toEqual([0, 1]);
      expect(slot.chosen.variant_index).toBe(0);
      expect(slot.starredIds).toEqual([rows[1].id]);
    });

    it("orders two 5/5 options by MO score", () => {
      const rows = [
        row("2026-10-05", "tea", 0, 7),
        row("2026-10-05", "tea", 1, 9, true),
        row("2026-10-05", "tea", 2, 8),
      ];

      const ratings = new Map([
        [rows[0].id, 5],
        [rows[2].id, 5],
      ]);
      const [slot] = groupPlanOptions(rows, ratings)[0].slots;

      expect(slot.options.map((option) => option.variant_index)).toEqual([2, 0, 1]);
      expect(slot.starredIds).toEqual([rows[2].id]);
    });

    it("stars both of two identical unrated top scores, a 3/5 counting as unrated", () => {
      const rows = [
        row("2026-10-05", "snack", 0, 8, true),
        row("2026-10-05", "snack", 1, 8),
        row("2026-10-05", "snack", 2, 6),
      ];

      const [slot] = groupPlanOptions(rows, new Map([[rows[1].id, 3]]))[0].slots;

      expect(slot.options.map((option) => option.variant_index)).toEqual([0, 1, 2]);
      expect(slot.starredIds).toEqual([rows[0].id, rows[1].id]);
    });

    it("keeps the stored chosen option, even when it is no longer first", () => {
      const rows = [row("2026-10-05", "lunch", 0, 9, true, true), row("2026-10-05", "lunch", 1, 7)];

      const [slot] = groupPlanOptions(rows, new Map([[rows[0].id, 1]]))[0].slots;

      expect(slot.options.map((option) => option.variant_index)).toEqual([1, 0]);
      expect(slot.chosen).toBe(rows[0]);
    });
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

describe("addDays", () => {
  it("shifts within a month", () => {
    expect(addDays("2026-10-02", -7)).toBe("2026-09-25");
    expect(addDays("2026-10-05", 4)).toBe("2026-10-09");
  });

  it("crosses month and year ends in both directions", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-11-03", -7)).toBe("2026-10-27");
    expect(addDays("2026-12-29", 7)).toBe("2027-01-05");
    expect(addDays("2027-01-03", -7)).toBe("2026-12-27");
  });

  it("handles the leap day", () => {
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2027-03-01", -1)).toBe("2027-02-28");
  });

  it("is independent of the runtime timezone and DST (tests run in UTC-10)", () => {
    expect(addDays("2026-10-25", 1)).toBe("2026-10-26");
    expect(addDays("2026-03-30", -1)).toBe("2026-03-29");
  });
});

describe("formatRecency", () => {
  it("uses the singular for 1 day", () => {
    expect(formatRecency("2026-10-02", "2026-10-01")).toBe("In your plan 1 day earlier (Thu 1 Oct)");
  });

  it("counts calendar days: 7 and 11 days, same year without the year", () => {
    expect(formatRecency("2026-10-08", "2026-10-01")).toBe("In your plan 7 days earlier (Thu 1 Oct)");
    expect(formatRecency("2026-10-12", "2026-10-01")).toBe("In your plan 11 days earlier (Thu 1 Oct)");
  });

  it("crosses a month end", () => {
    expect(formatRecency("2026-10-02", "2026-09-28")).toBe("In your plan 4 days earlier (Mon 28 Sep)");
  });

  it("shows the year when it differs from the meal's year", () => {
    expect(formatRecency("2027-01-04", "2026-12-28")).toBe("In your plan 7 days earlier (Mon 28 Dec 2026)");
  });

  it("is not shifted by a DST change between the two dates", () => {
    expect(formatRecency("2026-10-26", "2026-10-24")).toBe("In your plan 2 days earlier (Sat 24 Oct)");
  });
});

describe("formatEditableUntil", () => {
  it("is the day before the week starts", () => {
    expect(formatEditableUntil("2026-10-12")).toBe("Sun 11 Oct");
  });

  it("crosses a month boundary", () => {
    expect(formatEditableUntil("2026-11-02")).toBe("Sun 1 Nov");
    expect(formatEditableUntil("2026-06-01")).toBe("Sun 31 May");
  });
});

describe("formatSavedAt", () => {
  it("shows Warsaw summer time (UTC+2)", () => {
    expect(formatSavedAt("2026-10-09T16:42:00Z")).toBe("Fri 9 Oct, 18:42");
  });

  // Summer time ends on Sunday 2026-10-25 at 01:00 UTC (03:00 CEST -> 02:00 CET).
  it("shows Warsaw winter time (UTC+1) after the DST switch", () => {
    expect(formatSavedAt("2026-10-25T00:30:00Z")).toBe("Sun 25 Oct, 02:30");
    expect(formatSavedAt("2026-10-25T01:30:00Z")).toBe("Sun 25 Oct, 02:30");
    expect(formatSavedAt("2026-11-06T16:42:00Z")).toBe("Fri 6 Nov, 17:42");
  });

  it("moves to the next Warsaw day near midnight and pads the time", () => {
    expect(formatSavedAt("2026-12-31T23:05:00Z")).toBe("Fri 1 Jan, 00:05");
  });
});

describe("formatPlanSavedStatus", () => {
  it("shows the Warsaw save time for a saved plan", () => {
    expect(formatPlanSavedStatus("2026-10-09T16:42:00Z")).toBe("Saved Fri 9 Oct, 18:42");
  });

  it("names the suggested picks for a plan never saved", () => {
    expect(formatPlanSavedStatus(null)).toBe("Not saved: suggested picks");
  });
});
