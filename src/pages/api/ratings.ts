import type { APIRoute } from "astro";
import { z } from "zod";
import { RatingWriteError, rateMeal } from "@/lib/services/ratings";
import { createClient } from "@/lib/supabase";

export const prerender = false;

function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

const MAX_BODY_BYTES = 4 * 1024;

// rate_meal checks the option's real plan, owner, that it is chosen and the window.
const rateSchema = z.object({ optionId: z.uuid(), rating: z.int().min(1).max(5).nullable() });

const STATUS_BY_KIND = { not_found: 404, not_rateable: 409, failed: 500 } as const;
const ERROR_BY_KIND = { not_found: "not_found", not_rateable: "not_rateable", failed: "save_failed" } as const;

/**
 * Rate a meal the user had, or clear its rating with `rating: null` (cookie session), structured like
 * `handlePlanSave`. Answers 200 `{ rating }` (the stored rating, or `null` after a clear). Errors:
 * 400 `invalid_request`, 401 `unauthorized`, 404 `not_found`, 409 `not_rateable`, 413
 * `payload_too_large` (over 4 KiB), 503 `not_configured`, 500 `save_failed`.
 */
export const POST: APIRoute = async (context) => {
  // 1. Configuration.
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return json({ error: "not_configured" }, 503);
  }

  // 2. Authentication: a JSON client gets a 401, not the middleware's sign-in redirect.
  if (!context.locals.user) {
    return json({ error: "unauthorized" }, 401);
  }

  // 3. Body. Size-capped first, as in plan-save.ts: the body is a uuid and a number, so anything larger is not ours.
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
  const parsed = rateSchema.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      path: issue.path.map(String).join("."),
      message: issue.message,
    }));
    return json({ error: "invalid_request", issues }, 400);
  }
  const { optionId, rating } = parsed.data;

  // 4. Write. The database function checks the real owner, the chosen option and the window.
  try {
    return json({ rating: await rateMeal(supabase, optionId, rating) }, 200);
  } catch (error) {
    const kind = error instanceof RatingWriteError ? error.kind : "failed";
    if (kind === "failed") {
      // Code and message only (the service puts nothing else in its messages); never the body or the user.
      console.error(`rating save failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    return json({ error: ERROR_BY_KIND[kind] }, STATUS_BY_KIND[kind]);
  }
};
