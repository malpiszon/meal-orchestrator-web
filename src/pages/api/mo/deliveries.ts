import type { APIRoute } from "astro";
import { MO_INGEST_TOKEN } from "astro:env/server";
import { moDeliverySchema, toOptionRows, type MoDelivery } from "@/lib/mo-delivery";
import { createServiceClient } from "@/lib/supabase";

export const prerender = false;

const PROVISIONED_BY = "mo-delivery";
// GoTrue error codes for "a user with this email already exists" (a concurrent delivery created it).
const EMAIL_EXISTS_CODES = new Set(["email_exists", "user_already_exists"]);
// Postgres "untranslatable_character": a string Postgres can't store (e.g. "\u0000" in jsonb/text).
const UNTRANSLATABLE_CHARACTER = "22P05";
// A week is ~40 KB (see scripts/fixtures/mo-delivery.sample.json); anything far larger is a bug, not a menu.
const MAX_BODY_BYTES = 256 * 1024;

function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

/**
 * Constant-time token check that works on Workers (no `crypto.timingSafeEqual`):
 * hash both values to equal-length digests, then XOR every byte.
 */
async function tokensMatch(given: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [givenDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(given)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const a = new Uint8Array(givenDigest);
  const b = new Uint8Array(expectedDigest);
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

function bearerToken(request: Request): string | null {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(request.headers.get("Authorization") ?? "");
  return match?.[1] ?? null;
}

interface DbError {
  code?: string;
  message: string;
}

function logStorageError(step: string, error: DbError): void {
  // Never log the request body or the email; code and message only.
  console.error(`mo delivery ${step} failed: ${error.code ?? "unknown"} ${error.message}`);
}

export const POST: APIRoute = async ({ request }) => {
  // 1. Configuration.
  const supabase = createServiceClient();
  if (!supabase || !MO_INGEST_TOKEN) {
    return json({ error: "not_configured" }, 503);
  }

  // 2. Authentication.
  const token = bearerToken(request);
  if (!token || !(await tokensMatch(token, MO_INGEST_TOKEN))) {
    return json({ error: "unauthorized" }, 401);
  }

  // 3. Payload. Size-capped first: parsing and validating a huge body could exceed the Worker's CPU limit.
  if (Number(request.headers.get("Content-Length") ?? 0) > MAX_BODY_BYTES) {
    return json({ error: "payload_too_large" }, 413);
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    return json({ error: "payload_too_large" }, 413);
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "invalid_payload", issues: [{ path: "", message: "Request body is not valid JSON" }] }, 400);
  }
  const parsed = moDeliverySchema.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      path: issue.path.map(String).join("."),
      message: issue.message,
    }));
    return json({ error: "invalid_payload", issues }, 400);
  }
  const delivery: MoDelivery = parsed.data;

  // 4. Storage: one RPC; on unknown_user provision the account and call once more.
  const ingest = () =>
    supabase.rpc("ingest_weekly_plan", {
      p_email: delivery.user.email,
      p_provider: delivery.provider,
      p_week_start: delivery.week_start,
      p_week_end: delivery.week_end,
      p_run_id: delivery.run_id ?? null,
      // The body as received (top level validated; unknown nested keys kept), so later changes can re-derive data from it.
      p_raw: body,
      p_options: toOptionRows(delivery),
    });

  let result = await ingest();
  let accountCreated = false;

  if (result.error?.code === "P0002" && result.error.message === "unknown_user") {
    const { error: createError } = await supabase.auth.admin.createUser({
      email: delivery.user.email,
      email_confirm: false,
      app_metadata: { provisioned_by: PROVISIONED_BY },
    });
    if (createError && !EMAIL_EXISTS_CODES.has(createError.code ?? "")) {
      logStorageError("createUser", createError);
      return json({ error: "storage_failed" }, 500);
    }
    accountCreated = !createError;
    result = await ingest();
  }

  if (result.error?.code === UNTRANSLATABLE_CHARACTER) {
    // e.g. a "\u0000" in a string: valid JSON, but Postgres can't store it, so a retry would never succeed.
    return json(
      {
        error: "invalid_payload",
        issues: [{ path: "", message: "Payload contains a character that cannot be stored (\\u0000)" }],
      },
      400,
    );
  }
  if (result.error) {
    logStorageError("ingest_weekly_plan", result.error);
    return json({ error: "storage_failed" }, 500);
  }
  const planId: unknown = result.data;
  if (typeof planId !== "string") {
    logStorageError("ingest_weekly_plan", { message: "returned no plan id" });
    return json({ error: "storage_failed" }, 500);
  }

  // 5. Success.
  return json({ plan_id: planId, week_start: delivery.week_start, account_created: accountCreated }, 200);
};
