import type { APIRoute } from "astro";
import { z } from "zod";
import { json, readJsonRequest } from "@/lib/json-request";
import { RatingWriteError, rateMeal } from "@/lib/services/ratings";

export const prerender = false;

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
  // 1-3. Configuration, authentication, body (see `readJsonRequest`).
  const request = await readJsonRequest(context, rateSchema);
  if (!request.ok) {
    return request.response;
  }
  const {
    supabase,
    input: { optionId, rating },
  } = request;

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
