import type { SupabaseClient } from "@supabase/supabase-js";
import type { APIContext } from "astro";
import type { z } from "zod";
import { json, readJsonRequest } from "@/lib/json-request";
import { getPlanRecency, PlanWriteError } from "@/lib/services/plans";

/**
 * Shared request handling for the cookie-session plan writes (`/api/plans/choose`, `/api/plans/confirm`).
 * Each route saves, then re-reads the plan's recency so the island can update its notes in place.
 */

const STATUS_BY_KIND = { not_found: 404, plan_locked: 409, failed: 500 } as const;
const ERROR_BY_KIND = { not_found: "not_found", plan_locked: "plan_locked", failed: "save_failed" } as const;

function logError(step: string, error: unknown): void {
  // Code and message only (the services put nothing else in their messages); never the body or the user.
  console.error(`plan save ${step} failed: ${error instanceof Error ? error.message : String(error)}`);
}

/**
 * Validate the JSON body with `schema`, run `save` with the user's cookie-session client, then answer
 * 200 `{ saved_at, recency }`, where `recency` is option id → `YYYY-MM-DD` from `getPlanRecency(planId)`,
 * or `null` if that re-read failed (the save stands). Errors: 400 `invalid_request`, 401 `unauthorized`,
 * 404 `not_found`, 409 `plan_locked`, 413 `payload_too_large` (over 4 KiB), 503 `not_configured`,
 * 500 `save_failed`.
 */
export async function handlePlanSave<S extends z.ZodType<{ planId: string }>>(
  context: APIContext,
  schema: S,
  save: (supabase: SupabaseClient, input: z.infer<S>) => Promise<{ savedAt: string }>,
): Promise<Response> {
  // 1-3. Configuration, authentication, body (see `readJsonRequest`).
  const request = await readJsonRequest(context, schema);
  if (!request.ok) {
    return request.response;
  }
  const { supabase, input } = request;

  // 4. Save. The database function checks the real owner and the cut-off.
  let savedAt: string;
  try {
    ({ savedAt } = await save(supabase, input));
  } catch (error) {
    const kind = error instanceof PlanWriteError ? error.kind : "failed";
    if (kind === "failed") {
      logError("write", error);
    }
    return json({ error: ERROR_BY_KIND[kind] }, STATUS_BY_KIND[kind]);
  }

  // 5. Recency re-read (RLS-bound). Its failure doesn't undo the save: the island keeps its old notes.
  let recency: Record<string, string> | null = null;
  try {
    recency = Object.fromEntries(await getPlanRecency(supabase, input.planId));
  } catch (error) {
    logError("recency", error);
  }

  return json({ saved_at: savedAt, recency }, 200);
}
