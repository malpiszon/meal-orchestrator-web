import { z } from "zod";
import { MEAL_TYPES, type OptionRow } from "@/types";

/**
 * Payload v1 of MO's weekly delivery (`POST /api/mo/deliveries`).
 * Keep in sync with docs/mo-delivery-contract.md.
 * No `astro:env` import here, so Vitest can load this module.
 */

const MS_PER_DAY = 86_400_000;

/** Days since the Unix epoch for a validated `YYYY-MM-DD` string, computed in UTC. */
function epochDay(isoDate: string): number {
  return Date.parse(`${isoDate}T00:00:00Z`) / MS_PER_DAY;
}

function isMonday(isoDate: string): boolean {
  return new Date(`${isoDate}T00:00:00Z`).getUTCDay() === 1;
}

const isoDateSchema = z.iso.date();

const justificationSchema = z.object({
  icon: z.string(),
  text: z.string(),
});

const nutritionSchema = z.object({
  protein_g: z.number().optional(),
  fat_g: z.number().optional(),
  saturated_fat_g: z.number().optional(),
  carbs_g: z.number().optional(),
  sugar_g: z.number().optional(),
  fiber_g: z.number().optional(),
  salt_g: z.number().optional(),
});

const variantSchema = z.object({
  provider_meal_id: z.string().min(1),
  name: z.string().min(1),
  composition: z.string(),
  nutrition: nutritionSchema.optional(),
  score: z.int().min(1).max(10),
  justifications: z.array(justificationSchema).max(5),
});

const mealSchema = z
  .object({
    type: z.enum(MEAL_TYPES),
    variants: z.array(variantSchema).min(1).max(10),
  })
  .superRefine((meal, ctx) => {
    const seen = new Set<string>();
    meal.variants.forEach((variant, index) => {
      if (seen.has(variant.provider_meal_id)) {
        ctx.addIssue({
          code: "custom",
          path: ["variants", index, "provider_meal_id"],
          message: `Duplicate provider_meal_id "${variant.provider_meal_id}" within a meal`,
        });
      }
      seen.add(variant.provider_meal_id);
    });
  });

const daySchema = z
  .object({
    date: isoDateSchema,
    meals: z.array(mealSchema).min(1),
  })
  .superRefine((day, ctx) => {
    const seen = new Set<string>();
    day.meals.forEach((meal, index) => {
      if (seen.has(meal.type)) {
        ctx.addIssue({
          code: "custom",
          path: ["meals", index, "type"],
          message: `Duplicate meal type "${meal.type}" within a day`,
        });
      }
      seen.add(meal.type);
    });
  });

export const moDeliverySchema = z
  .strictObject({
    schema_version: z.literal(1),
    run_id: z.string().optional(),
    provider: z.string().min(1),
    week_start: isoDateSchema,
    week_end: isoDateSchema,
    user: z.object({ email: z.email() }),
    // At least one day: an empty delivery would replace (wipe) an already stored week.
    days: z.array(daySchema).min(1),
  })
  .superRefine((delivery, ctx) => {
    if (!isMonday(delivery.week_start)) {
      ctx.addIssue({ code: "custom", path: ["week_start"], message: "week_start must be a Monday" });
    }

    const start = epochDay(delivery.week_start);
    const end = epochDay(delivery.week_end);
    if (end < start || end > start + 6) {
      ctx.addIssue({
        code: "custom",
        path: ["week_end"],
        message: "week_end must be between week_start and week_start + 6 days",
      });
    }

    const seen = new Set<string>();
    delivery.days.forEach((day, index) => {
      if (seen.has(day.date)) {
        ctx.addIssue({ code: "custom", path: ["days", index, "date"], message: `Duplicate date ${day.date}` });
      }
      seen.add(day.date);

      const date = epochDay(day.date);
      if (date < start || date > end) {
        ctx.addIssue({
          code: "custom",
          path: ["days", index, "date"],
          message: `Date ${day.date} is outside [week_start, week_end]`,
        });
      }
    });
  });

export type MoDelivery = z.infer<typeof moDeliverySchema>;

/**
 * Flatten a validated delivery into `ingest_weekly_plan` option rows.
 * `variant_index` is the array position (the menu's order). Exactly one option per
 * (date, meal type) is recommended: the highest score, ties going to the lowest index.
 */
export function toOptionRows(delivery: MoDelivery): OptionRow[] {
  const rows: OptionRow[] = [];

  for (const day of delivery.days) {
    for (const meal of day.meals) {
      let recommendedIndex = 0;
      let bestScore = -Infinity;
      meal.variants.forEach((variant, index) => {
        // Strictly greater: an equal score never displaces an earlier option.
        if (variant.score > bestScore) {
          recommendedIndex = index;
          bestScore = variant.score;
        }
      });

      meal.variants.forEach((variant, index) => {
        rows.push({
          meal_date: day.date,
          meal_type: meal.type,
          variant_index: index,
          provider_meal_id: variant.provider_meal_id,
          name: variant.name,
          composition: variant.composition === "" ? null : variant.composition,
          nutrition: variant.nutrition ?? null,
          score: variant.score,
          justifications: variant.justifications,
          is_recommended: index === recommendedIndex,
        });
      });
    }
  }

  return rows;
}
