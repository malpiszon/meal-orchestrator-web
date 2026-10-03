import { MEAL_TYPES, type MealType, type PlanDay, type PlanSlot } from "@/types";

/**
 * Pure plan-state helpers for the dashboard. No `astro:env` import, so Vitest can load this module.
 */

/** The fields of an option row that grouping relies on. */
export interface GroupableOption {
  meal_date: string;
  meal_type: string;
  variant_index: number;
  score: number;
  is_recommended: boolean;
  is_chosen: boolean;
}

const warsawDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Warsaw",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Today's calendar date (`YYYY-MM-DD`) in Europe/Warsaw, the timezone MO plans weeks in. */
export function todayInWarsaw(now: Date): string {
  const parts = warsawDate.formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function isMealType(value: string): value is MealType {
  return (MEAL_TYPES as readonly string[]).includes(value);
}

/** Best first: score descending, then menu order (lowest `variant_index`). */
function byScoreThenIndex(a: GroupableOption, b: GroupableOption): number {
  return b.score - a.score || a.variant_index - b.variant_index;
}

/**
 * Group a plan's option rows into days (date order) and meal slots (MO's slot order, `MEAL_TYPES`).
 * Each slot holds its `chosen` option, the `others`, and all `options`, each sorted by score
 * descending, then index, plus the slot's `topScore`. Rows whose `meal_type` is not in `MEAL_TYPES`
 * are skipped. `chosen` is the `is_chosen` row; without one, the `is_recommended` row; without that,
 * the best option (highest score, lowest index).
 */
export function groupPlanOptions<T extends GroupableOption>(rows: readonly T[]): PlanDay<T>[] {
  const byDate = new Map<string, Map<MealType, T[]>>();
  for (const row of rows) {
    if (!isMealType(row.meal_type)) continue;
    let slots = byDate.get(row.meal_date);
    if (!slots) {
      slots = new Map();
      byDate.set(row.meal_date, slots);
    }
    const options = slots.get(row.meal_type);
    if (options) {
      options.push(row);
    } else {
      slots.set(row.meal_type, [row]);
    }
  }

  // `YYYY-MM-DD` strings sort chronologically.
  return [...byDate.keys()].sort().map((date) => {
    const slotsByType = byDate.get(date) ?? new Map<MealType, T[]>();
    const slots: PlanSlot<T>[] = [];
    for (const mealType of MEAL_TYPES) {
      const options = slotsByType.get(mealType);
      if (!options?.length) continue;
      const sorted = [...options].sort(byScoreThenIndex);
      const chosen =
        sorted.find((option) => option.is_chosen) ?? sorted.find((option) => option.is_recommended) ?? sorted[0];
      slots.push({
        mealType,
        chosen,
        others: sorted.filter((option) => option !== chosen),
        options: sorted,
        topScore: sorted[0].score,
      });
    }
    return { date, slots };
  });
}

/** Human label for a meal type, derived from its identifier: `second_breakfast` → "Second breakfast". */
export function mealTypeLabel(mealType: MealType): string {
  const words = mealType.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// Dates are calendar dates: format them at UTC midnight in UTC, so the label never shifts by a day.
function utcMidnight(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00Z`);
}

const dayFormat = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

const monthFormat = new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "UTC" });

/** e.g. `2026-10-05` → "Monday 5 October". */
export function formatDayLabel(isoDate: string): string {
  return dayFormat.format(utcMidnight(isoDate));
}

/**
 * e.g. `2026-10-05`, `2026-10-09` → "5–9 October 2026"; across months "28 September – 2 October 2026".
 * Built by hand: `formatRange` spacing differs between ICU versions (Node vs workerd).
 */
export function formatWeekRange(weekStart: string, weekEnd: string): string {
  const [start, end] = [utcMidnight(weekStart), utcMidnight(weekEnd)];
  const startYear = start.getUTCFullYear();
  const endYear = end.getUTCFullYear();
  const startMonth = monthFormat.format(start);
  const endMonth = monthFormat.format(end);
  const tail = `${end.getUTCDate()} ${endMonth} ${endYear}`;

  if (startYear !== endYear) {
    return `${start.getUTCDate()} ${startMonth} ${startYear} – ${tail}`;
  }
  if (start.getUTCMonth() !== end.getUTCMonth()) {
    return `${start.getUTCDate()} ${startMonth} – ${tail}`;
  }
  return `${start.getUTCDate()}–${tail}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** `isoDate` shifted by `days` calendar days (negative goes back), e.g. `2026-03-01`, -1 → `2026-02-28`. */
export function addDays(isoDate: string, days: number): string {
  return new Date(utcMidnight(isoDate).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

// Hand-built rather than Intl: short month names differ between ICU versions ("Sept" vs "Sep" in
// en-GB), and the build runs on workerd while tests run on Node.
const SHORT_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/**
 * The recency note for a meal planned on `mealDate` that was last planned on `lastPlannedOn` (earlier),
 * e.g. `2026-10-12`, `2026-10-01` → "In your plan 11 days earlier (Thu 1 Oct)". The year is appended
 * only when it differs from `mealDate`'s year. Assumes `lastPlannedOn` is strictly before `mealDate`,
 * as `get_plan_recency` guarantees; otherwise the count is 0 or negative.
 */
export function formatRecency(mealDate: string, lastPlannedOn: string): string {
  const meal = utcMidnight(mealDate);
  const last = utcMidnight(lastPlannedOn);
  const days = Math.round((meal.getTime() - last.getTime()) / DAY_MS);
  const year = last.getUTCFullYear() === meal.getUTCFullYear() ? "" : ` ${last.getUTCFullYear()}`;
  const date = `${SHORT_WEEKDAYS[last.getUTCDay()]} ${last.getUTCDate()} ${SHORT_MONTHS[last.getUTCMonth()]}${year}`;
  return `In your plan ${days} ${days === 1 ? "day" : "days"} earlier (${date})`;
}

/** The last day the plan starting on `weekStart` can be edited, e.g. `2026-10-12` → "Sun 11 Oct". */
export function formatEditableUntil(weekStart: string): string {
  const day = utcMidnight(addDays(weekStart, -1));
  return `${SHORT_WEEKDAYS[day.getUTCDay()]} ${day.getUTCDate()} ${SHORT_MONTHS[day.getUTCMonth()]}`;
}

// Numeric parts only: names come from the hand-built arrays, so Node and workerd agree.
const warsawDateTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Warsaw",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** A save time as Europe/Warsaw wall-clock time, e.g. `2026-10-09T16:42:00Z` → "Fri 9 Oct, 18:42". */
export function formatSavedAt(isoTimestamp: string): string {
  const parts = warsawDateTime.formatToParts(new Date(isoTimestamp));
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const [year, month, day] = [part("year"), part("month"), part("day")];
  // The weekday of the Warsaw calendar date, computed at UTC midnight so the runtime timezone can't shift it.
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${SHORT_WEEKDAYS[weekday]} ${day} ${SHORT_MONTHS[month - 1]}, ${pad(part("hour"))}:${pad(part("minute"))}`;
}
