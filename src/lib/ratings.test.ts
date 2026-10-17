import { describe, expect, it } from "vitest";
import { isDayFullyRated, isRateable, RATING_FACES, ratingFace } from "@/lib/ratings";
import type { MealType, PlanDay, PlanMealOption, PlanSlot } from "@/types";

describe("RATING_FACES", () => {
  it("lists the scale worst first, values 1 to 5", () => {
    expect(RATING_FACES.map((face) => [face.value, face.emoji, face.label])).toEqual([
      [1, "🤢", "Never again"],
      [2, "😕", "Meh"],
      [3, "😐", "Fine"],
      [4, "🙂", "Tasty"],
      [5, "😋", "Chef's kiss"],
    ]);
  });
});

describe("ratingFace", () => {
  it("finds the face of each value on the scale", () => {
    expect(ratingFace(1)?.label).toBe("Never again");
    expect(ratingFace(3)?.emoji).toBe("😐");
    expect(ratingFace(5)?.label).toBe("Chef's kiss");
  });

  it("returns undefined off the scale", () => {
    expect(ratingFace(0)).toBeUndefined();
    expect(ratingFace(6)).toBeUndefined();
  });
});

describe("isRateable", () => {
  // Wednesday 2026-10-14: the window is 2026-10-07 .. 2026-10-14.
  const today = "2026-10-14";

  it("today is rateable", () => {
    expect(isRateable("2026-10-14", today)).toBe(true);
  });

  it("today - 7 is rateable", () => {
    expect(isRateable("2026-10-07", today)).toBe(true);
  });

  it("today + 1 is not rateable", () => {
    expect(isRateable("2026-10-15", today)).toBe(false);
  });

  it("today - 8 is not rateable", () => {
    expect(isRateable("2026-10-06", today)).toBe(false);
  });

  it("works across a month boundary: on 2026-11-03 the window starts 2026-10-27", () => {
    expect(isRateable("2026-10-27", "2026-11-03")).toBe(true);
    expect(isRateable("2026-10-26", "2026-11-03")).toBe(false);
    expect(isRateable("2026-11-01", "2026-11-03")).toBe(true);
  });
});

describe("isDayFullyRated", () => {
  const date = "2026-10-12";

  function option(id: string, rating: number | null, is_chosen = false): PlanMealOption {
    return {
      id,
      meal_date: date,
      meal_type: "lunch",
      variant_index: 0,
      provider_meal_id: id,
      name: id,
      composition: null,
      nutrition: null,
      score: 5,
      justifications: [],
      is_recommended: false,
      is_chosen,
      meal_ratings: rating === null ? null : { rating },
    };
  }

  /** A slot whose chosen option has `rating`, plus an option that isn't chosen with `otherRating`. */
  function slot(mealType: MealType, rating: number | null, otherRating: number | null = null): PlanSlot {
    const chosen = option(`${mealType}/chosen`, rating, true);
    const other = option(`${mealType}/other`, otherRating);
    return { mealType, chosen, others: [other], options: [chosen, other], starredIds: [chosen.id] };
  }

  function day(...slots: PlanSlot[]): PlanDay {
    return { date, slots };
  }

  it("every chosen meal rated is fully rated", () => {
    expect(isDayFullyRated(day(slot("breakfast", 5), slot("lunch", 3)))).toBe(true);
  });

  it("one chosen meal unrated is not fully rated", () => {
    expect(isDayFullyRated(day(slot("breakfast", 5), slot("lunch", null)))).toBe(false);
  });

  it("a rated option that isn't chosen doesn't count", () => {
    expect(isDayFullyRated(day(slot("breakfast", 5), slot("lunch", null, 4)))).toBe(false);
  });

  it("a day with no slots is not fully rated", () => {
    expect(isDayFullyRated(day())).toBe(false);
  });

  it("the lowest rating, 1, counts as rated", () => {
    expect(isDayFullyRated(day(slot("breakfast", 1), slot("lunch", 1)))).toBe(true);
  });
});
