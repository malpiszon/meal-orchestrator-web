/** Meal slots MO can deliver, in MO's slot order. The single source for `MealType` and the payload schema. */
export const MEAL_TYPES = ["breakfast", "second_breakfast", "lunch", "tea", "dinner", "snack"] as const;

export type MealType = (typeof MEAL_TYPES)[number];

export interface Justification {
  icon: string;
  text: string;
}

/** Per-portion nutrition in grams; MO omits unknown values. */
export interface Nutrition {
  protein_g?: number;
  fat_g?: number;
  saturated_fat_g?: number;
  carbs_g?: number;
  sugar_g?: number;
  fiber_g?: number;
  salt_g?: number;
}

/**
 * One menu option of a delivered week, shaped like an element of the
 * `p_options` argument of `public.ingest_weekly_plan` (and a `plan_meal_options` row).
 */
export interface OptionRow {
  meal_date: string;
  meal_type: MealType;
  variant_index: number;
  provider_meal_id: string;
  name: string;
  composition: string | null;
  nutrition: Nutrition | null;
  score: number;
  justifications: Justification[];
  is_recommended: boolean;
}

/** A `plan_meal_options` row as read back through the user's (RLS-bound) client. */
export interface PlanMealOption {
  id: string;
  meal_date: string;
  /** Stored as text; rows outside `MEAL_TYPES` are skipped when grouping. */
  meal_type: string;
  variant_index: number;
  provider_meal_id: string;
  name: string;
  composition: string | null;
  nutrition: Nutrition | null;
  score: number;
  justifications: Justification[];
  is_recommended: boolean;
  /** The user's choice for the slot; MO's recommendation until the user swaps. */
  is_chosen: boolean;
  /** The user's rating of this option (1-5), embedded from `meal_ratings`; `null` when not rated. */
  meal_ratings: { rating: number } | null;
}

/** A `weekly_plans` row with its embedded options (raw payload not selected). */
export interface WeeklyPlan {
  id: string;
  provider: string;
  week_start: string;
  week_end: string;
  received_at: string;
  /** When the user last saved the plan (a choice or a confirm); `null` when never saved. */
  saved_at: string | null;
  plan_meal_options: PlanMealOption[];
}

/** A `weekly_plans` row as the history list reads it: no options. */
export interface PastPlanSummary {
  id: string;
  week_start: string;
  week_end: string;
  /** `null` when the plan was never saved. */
  saved_at: string | null;
}

/** One meal slot of a day: the chosen option, the others and all options, best first. */
export interface PlanSlot<T = PlanMealOption> {
  mealType: MealType;
  /** The headline: the user's choice (falls back to MO's recommendation, then the best option). */
  chosen: T;
  /** Every option except `chosen`, best first. */
  others: T[];
  /** Every option of the slot, best first, in an order independent of the choice (for the editor). */
  options: T[];
  /** The slot's highest score; every option with this score gets the star. */
  topScore: number;
}

export interface PlanDay<T = PlanMealOption> {
  date: string;
  slots: PlanSlot<T>[];
}
