/** Meal slots MO can deliver, in MO's slot order. */
export type MealType = "breakfast" | "second_breakfast" | "lunch" | "tea" | "dinner" | "snack";

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
