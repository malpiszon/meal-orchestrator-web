import { describe, expect, it } from "vitest";
import sample from "../../scripts/fixtures/mo-delivery.sample.json";
import { moDeliverySchema, toOptionRows, type MoDelivery } from "@/lib/mo-delivery";

/** A fresh, mutable copy of the sample payload. */
function sampleDelivery(): MoDelivery {
  return structuredClone(sample) as MoDelivery;
}

function firstMeal(delivery: MoDelivery) {
  return delivery.days[0].meals[0];
}

type MutableDelivery = Record<string, unknown> & MoDelivery;

/** Applies `mutate` to a copy of the sample and returns the dotted paths of every validation issue. */
function issuePaths(mutate: (delivery: MutableDelivery) => void): string[] {
  const delivery = sampleDelivery() as MutableDelivery;
  mutate(delivery);
  const result = moDeliverySchema.safeParse(delivery);
  return (result.error?.issues ?? []).map((issue) => issue.path.map(String).join("."));
}

const FIRST_VARIANT = "days.0.meals.0.variants.0";

describe("moDeliverySchema", () => {
  it("accepts the sample payload", () => {
    const result = moDeliverySchema.safeParse(sample);
    expect(result.error?.issues).toBeUndefined();
    expect(result.success).toBe(true);
  });

  it('accepts composition "" and maps it to null', () => {
    const delivery = sampleDelivery();
    firstMeal(delivery).variants[0].composition = "";

    const parsed = moDeliverySchema.parse(delivery);
    const rows = toOptionRows(parsed);
    expect(rows[0].composition).toBeNull();
    expect(rows[1].composition).not.toBeNull();
  });

  it("rejects a week_start that is not a Monday", () => {
    // Sunday before the sample week: every day and week_end stay in range, so only the Monday rule fires.
    expect(
      issuePaths((d) => {
        d.week_start = "2026-06-28";
      }),
    ).toEqual(["week_start"]);
  });

  it("rejects a week_end more than 6 days after week_start", () => {
    expect(
      issuePaths((d) => {
        d.week_end = "2026-07-06";
      }),
    ).toEqual(["week_end"]);
  });

  it("rejects a date outside the week", () => {
    expect(
      issuePaths((d) => {
        d.days[0].date = "2026-07-06";
      }),
    ).toEqual(["days.0.date"]);
  });

  it("rejects a duplicate date", () => {
    expect(
      issuePaths((d) => {
        d.days[1].date = d.days[0].date;
      }),
    ).toEqual(["days.1.date"]);
  });

  it("rejects a delivery without days", () => {
    expect(
      issuePaths((d) => {
        d.days = [];
      }),
    ).toEqual(["days"]);
  });

  it("rejects a day without meals", () => {
    expect(
      issuePaths((d) => {
        d.days[0].meals = [];
      }),
    ).toEqual(["days.0.meals"]);
  });

  it("rejects a duplicate meal type within a day", () => {
    expect(
      issuePaths((d) => {
        const meals = d.days[0].meals;
        meals[1].type = meals[0].type;
      }),
    ).toEqual(["days.0.meals.1.type"]);
  });

  it("rejects a meal without variants", () => {
    expect(
      issuePaths((d) => {
        firstMeal(d).variants = [];
      }),
    ).toEqual(["days.0.meals.0.variants"]);
  });

  it("rejects a meal with more than 10 variants", () => {
    expect(
      issuePaths((d) => {
        const meal = firstMeal(d);
        meal.variants = Array.from({ length: 11 }, (_, index) => ({
          ...meal.variants[0],
          provider_meal_id: String(9000 + index),
        }));
      }),
    ).toEqual(["days.0.meals.0.variants"]);
  });

  it("rejects a duplicate provider_meal_id within a meal", () => {
    expect(
      issuePaths((d) => {
        const variants = firstMeal(d).variants;
        variants[1].provider_meal_id = variants[0].provider_meal_id;
      }),
    ).toEqual(["days.0.meals.0.variants.1.provider_meal_id"]);
  });

  it.each([0, 11, 7.5])("rejects score %s", (score) => {
    expect(
      issuePaths((d) => {
        firstMeal(d).variants[0].score = score;
      }),
    ).toEqual([`${FIRST_VARIANT}.score`]);
  });

  it("rejects more than 5 justifications", () => {
    expect(
      issuePaths((d) => {
        const variant = firstMeal(d).variants[0];
        variant.justifications = Array.from({ length: 6 }, () => ({ icon: "⚖️", text: "…" }));
      }),
    ).toEqual([`${FIRST_VARIANT}.justifications`]);
  });

  it("rejects an unknown top-level key", () => {
    const delivery = sampleDelivery() as MutableDelivery;
    delivery.extra = true;
    const issues = moDeliverySchema.safeParse(delivery).error?.issues ?? [];
    expect(issues.map((issue) => issue.code)).toEqual(["unrecognized_keys"]);
  });

  it("rejects a variant without provider_meal_id", () => {
    expect(
      issuePaths((d) => {
        const variant: Partial<Record<"provider_meal_id", string>> = firstMeal(d).variants[0];
        delete variant.provider_meal_id;
      }),
    ).toEqual([`${FIRST_VARIANT}.provider_meal_id`]);
  });
});

describe("toOptionRows", () => {
  const rows = toOptionRows(moDeliverySchema.parse(sample));

  it("marks exactly one recommended option per slot", () => {
    const slots = new Map<string, number>();
    for (const row of rows) {
      const key = `${row.meal_date}|${row.meal_type}`;
      slots.set(key, (slots.get(key) ?? 0) + (row.is_recommended ? 1 : 0));
    }
    expect(slots.size).toBe(10);
    expect([...slots.values()].every((count) => count === 1)).toBe(true);
  });

  it("recommends the highest score, resolving a tie to the lowest index", () => {
    const delivery = sampleDelivery();
    const meal = firstMeal(delivery);
    meal.variants.forEach((variant, index) => {
      variant.score = index === 0 ? 5 : 9;
    });

    const slot = toOptionRows(delivery).filter(
      (row) => row.meal_date === delivery.days[0].date && row.meal_type === meal.type,
    );
    expect(slot.map((row) => row.is_recommended)).toEqual([false, true, false]);
  });

  it("sets variant_index to the array order", () => {
    const delivery = sampleDelivery();
    const meal = firstMeal(delivery);
    const slot = toOptionRows(delivery).filter(
      (row) => row.meal_date === delivery.days[0].date && row.meal_type === meal.type,
    );
    expect(slot.map((row) => row.variant_index)).toEqual([0, 1, 2]);
    expect(slot.map((row) => row.provider_meal_id)).toEqual(meal.variants.map((v) => v.provider_meal_id));
  });
});
