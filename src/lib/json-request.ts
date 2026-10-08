import type { SupabaseClient } from "@supabase/supabase-js";
import type { APIContext } from "astro";
import type { z } from "zod";
import { createClient } from "@/lib/supabase";

/**
 * Shared request handling for the cookie-session JSON writes (`/api/plans/*`, `/api/ratings`).
 */

/** A JSON response with `status`. */
export function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

const MAX_BODY_BYTES = 4 * 1024;

/** The request's user client and validated body, or the error response to send instead. */
export type JsonRequest<T> = { ok: true; supabase: SupabaseClient; input: T } | { ok: false; response: Response };

/**
 * Checks, in order: configuration (503 `not_configured`), a signed-in user (401 `unauthorized`, not the
 * middleware's sign-in redirect), the body size (413 `payload_too_large` over 4 KiB), JSON and `schema`
 * (400 `invalid_request` with `issues`). Returns the user's cookie-session client and the parsed body.
 */
export async function readJsonRequest<S extends z.ZodType>(
  context: APIContext,
  schema: S,
): Promise<JsonRequest<z.infer<S>>> {
  // 1. Configuration.
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return { ok: false, response: json({ error: "not_configured" }, 503) };
  }

  // 2. Authentication: a JSON client gets a 401, not the middleware's sign-in redirect.
  if (!context.locals.user) {
    return { ok: false, response: json({ error: "unauthorized" }, 401) };
  }

  // 3. Body. Size-capped first, as in deliveries.ts: the bodies are a few ids, so anything larger is not ours.
  const tooLarge = { ok: false, response: json({ error: "payload_too_large" }, 413) } as const;
  if (Number(context.request.headers.get("Content-Length") ?? 0) > MAX_BODY_BYTES) {
    return tooLarge;
  }
  const text = await context.request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    return tooLarge;
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    const issues = [{ path: "", message: "Request body is not valid JSON" }];
    return { ok: false, response: json({ error: "invalid_request", issues }, 400) };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      path: issue.path.map(String).join("."),
      message: issue.message,
    }));
    return { ok: false, response: json({ error: "invalid_request", issues }, 400) };
  }
  return { ok: true, supabase, input: parsed.data };
}
