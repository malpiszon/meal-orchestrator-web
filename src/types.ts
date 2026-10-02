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
}

/** A `weekly_plans` row with its embedded options (raw payload not selected). */
export interface WeeklyPlan {
  id: string;
  provider: string;
  week_start: string;
  week_end: string;
  received_at: string;
  plan_meal_options: PlanMealOption[];
}

/** One meal slot of a day: the recommended option plus the others, best first. */
export interface PlanSlot<T = PlanMealOption> {
  mealType: MealType;
  recommended: T;
  others: T[];
}

export interface PlanDay<T = PlanMealOption> {
  date: string;
  slots: PlanSlot<T>[];
}
