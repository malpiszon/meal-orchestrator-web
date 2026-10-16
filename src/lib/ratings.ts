import { addDays } from "@/lib/plans";
import type { PlanDay } from "@/types";

/**
 * Pure rating helpers shared by the rating island and the server. No `astro:env` import, so Vitest can
 * load this module.
 */

/** A rating on the five-step scale, 1 (Never again) to 5 (Chef's kiss), as `meal_ratings.rating` stores it. */
export type RatingValue = 1 | 2 | 3 | 4 | 5;

/** One step of the rating scale: its stored value, its face and its label. */
export interface RatingFace {
  value: RatingValue;
  emoji: string;
  label: string;
}

/** The rating scale, worst first. */
export const RATING_FACES: readonly RatingFace[] = [
  { value: 1, emoji: "🤢", label: "Never again" },
  { value: 2, emoji: "😕", label: "Meh" },
  { value: 3, emoji: "😐", label: "Fine" },
  { value: 4, emoji: "🙂", label: "Tasty" },
  { value: 5, emoji: "😋", label: "Chef's kiss" },
];

/** The face of a stored rating, e.g. `5` → 😋 Chef's kiss; `undefined` for a value off the scale. */
export function ratingFace(value: number): RatingFace | undefined {
  return RATING_FACES.find((face) => face.value === value);
}

/**
 * Whether a chosen meal on `mealDate` can be rated on `today` (both `YYYY-MM-DD`, `today` from
 * `todayInWarsaw`): `today - 7 <= mealDate <= today`, both ends inclusive, as `public.rate_meal` checks.
 */
export function isRateable(mealDate: string, today: string): boolean {
  // `YYYY-MM-DD` strings compare chronologically.
  return addDays(today, -7) <= mealDate && mealDate <= today;
}

/**
 * Whether every chosen meal of `day` has a stored rating (any value, 1 included). Ratings on options that
 * aren't chosen don't count; a day with no slots is not fully rated.
 */
export function isDayFullyRated(day: PlanDay): boolean {
  return day.slots.length > 0 && day.slots.every((slot) => slot.chosen.meal_ratings !== null);
}
