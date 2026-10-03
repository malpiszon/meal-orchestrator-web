import type { SupabaseClient } from "@supabase/supabase-js";
import type { APIContext } from "astro";
import type { z } from "zod";
import { getPlanRecency, PlanWriteError } from "@/lib/services/plans";
import { createClient } from "@/lib/supabase";

/**
 * Shared request handling for the cookie-session plan writes (`/api/plans/choose`, `/api/plans/confirm`).
 * Each route saves, then re-reads the plan's recency so the island can update its notes in place.
 */

function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

const MAX_BODY_BYTES = 4 * 1024;

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
  // 1. Configuration.
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return json({ error: "not_configured" }, 503);
  }

  // 2. Authentication: a JSON client gets a 401, not the middleware's sign-in redirect.
  if (!context.locals.user) {
    return json({ error: "unauthorized" }, 401);
  }

  // 3. Body. Size-capped first, as in deliveries.ts: the bodies are two uuids, so anything larger is not ours.
  if (Number(context.request.headers.get("Content-Length") ?? 0) > MAX_BODY_BYTES) {
    return json({ error: "payload_too_large" }, 413);
  }
  const text = await context.request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    return json({ error: "payload_too_large" }, 413);
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "invalid_request", issues: [{ path: "", message: "Request body is not valid JSON" }] }, 400);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      path: issue.path.map(String).join("."),
      message: issue.message,
    }));
    return json({ error: "invalid_request", issues }, 400);
  }
  const input = parsed.data;

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
