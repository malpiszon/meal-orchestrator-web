// MO deliveries for e2e: the sample week from scripts/fixtures, moved to a week relative to today in Warsaw.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, type APIRequestContext } from "@playwright/test";
import type { MoDelivery } from "@/lib/mo-delivery";

const MS_PER_DAY = 86_400_000;
const SAMPLE_URL = new URL("../../../scripts/fixtures/mo-delivery.sample.json", import.meta.url);

/** Epoch milliseconds of a `YYYY-MM-DD` date at 00:00 UTC; all date arithmetic here stays in UTC. */
const utcMidnight = (date: string): number => Date.parse(`${date}T00:00:00Z`);

/** `YYYY-MM-DD` of epoch milliseconds, read in UTC. */
const isoDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** The Monday of the week holding `today` (a Warsaw `YYYY-MM-DD`): `today` itself on a Monday. */
export function thisMonday(today: string): string {
  const ms = utcMidnight(today);
  // getUTCDay: Sunday 0 … Saturday 6; days back to Monday: Sunday 6, Monday 0, Tuesday 1, …
  const daysSinceMonday = (new Date(ms).getUTCDay() + 6) % 7;
  return isoDate(ms - daysSinceMonday * MS_PER_DAY);
}

/** The Monday after `thisMonday(today)`: the dashboard's "Next week". */
export function nextMonday(today: string): string {
  return isoDate(utcMidnight(thisMonday(today)) + 7 * MS_PER_DAY);
}

/**
 * The sample delivery for `email`, every date shifted by the days from the sample's `week_start` to `weekStart`
 * (a Monday, `YYYY-MM-DD`).
 */
function buildDelivery(email: string, weekStart: string, runId: string): MoDelivery {
  const sample = JSON.parse(readFileSync(SAMPLE_URL, "utf8")) as MoDelivery;
  const delta = utcMidnight(weekStart) - utcMidnight(sample.week_start);
  const shift = (date: string) => isoDate(utcMidnight(date) + delta);
  return {
    ...sample,
    run_id: runId,
    user: { email },
    week_start: weekStart,
    week_end: shift(sample.week_end),
    days: sample.days.map((day) => ({ ...day, date: shift(day.date) })),
  };
}

/**
 * Delivers the sample week starting on `weekStart` for `email` through `/api/mo/deliveries`, as MO does, and
 * expects a 2xx. Each call gets a new `run_id` unless `runId` is given; the same `runId`, email and week send an
 * identical body, which the app treats as a no-op re-send.
 */
export async function deliverWeek(
  request: APIRequestContext,
  { email, weekStart, runId = `e2e-${randomUUID()}` }: { email: string; weekStart: string; runId?: string },
): Promise<void> {
  const token = process.env.MO_INGEST_TOKEN;
  if (!token) throw new Error("Set MO_INGEST_TOKEN (the app's MO delivery token) to deliver e2e weeks");

  const response = await request.post("/api/mo/deliveries", {
    headers: { Authorization: `Bearer ${token}` },
    data: buildDelivery(email, weekStart, runId),
  });
  expect(response.ok(), `MO delivery for ${weekStart} answered ${response.status()}: ${await response.text()}`).toBe(
    true,
  );
}
