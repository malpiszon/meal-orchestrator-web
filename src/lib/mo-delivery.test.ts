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

function rejects(mutate: (delivery: Record<string, unknown> & MoDelivery) => void): boolean {
  const delivery = sampleDelivery() as Record<string, unknown> & MoDelivery;
  mutate(delivery);
  return !moDeliverySchema.safeParse(delivery).success;
}

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
    expect(
      rejects((d) => {
        d.week_start = "2026-06-30";
      }),
    ).toBe(true);
  });

  it("rejects a date outside the week", () => {
    expect(
      rejects((d) => {
        d.days[0].date = "2026-07-06";
      }),
    ).toBe(true);
  });

  it("rejects a duplicate meal type within a day", () => {
    expect(
      rejects((d) => {
        const meals = d.days[0].meals;
        meals[1].type = meals[0].type;
      }),
    ).toBe(true);
  });

  it.each([0, 11])("rejects score %i", (score) => {
    expect(
      rejects((d) => {
        firstMeal(d).variants[0].score = score;
      }),
    ).toBe(true);
  });

  it("rejects an unknown top-level key", () => {
    expect(
      rejects((d) => {
        d.extra = true;
      }),
    ).toBe(true);
  });

  it("rejects a variant without provider_meal_id", () => {
    expect(
      rejects((d) => {
        const variant: Partial<Record<"provider_meal_id", string>> = firstMeal(d).variants[0];
        delete variant.provider_meal_id;
      }),
    ).toBe(true);
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
