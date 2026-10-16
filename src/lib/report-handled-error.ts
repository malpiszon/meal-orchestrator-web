import { captureException } from "@sentry/cloudflare";
import { maskEmails } from "@/lib/sentry-privacy";

const HINT_MAX_LENGTH = 200;

// A `cause` chain is short; the bound only guards against a cycle.
const MAX_CAUSE_DEPTH = 10;

/** `error`, then its `cause`, then that one's `cause`, …: only the objects. */
function causeChain(error: unknown): object[] {
  const chain: object[] = [];
  let current: unknown = error;
  while (typeof current === "object" && current !== null && chain.length < MAX_CAUSE_DEPTH) {
    if (chain.includes(current)) break;
    chain.push(current);
    current = (current as { cause?: unknown }).cause;
  }
  return chain;
}

function firstString(chain: object[], key: "code" | "hint"): string | undefined {
  for (const link of chain) {
    const value: unknown = (link as Record<string, unknown>)[key];
    if (typeof value === "string" && value !== "") return value;
  }
  return undefined;
}

function firstStatus(chain: object[]): number | undefined {
  for (const link of chain) {
    const value: unknown = (link as Record<string, unknown>).status;
    if (typeof value === "number") return value;
  }
  return undefined;
}

// A PostgREST network failure has an empty `code`, so the HTTP status is the next best grouping key.
function errorCode(chain: object[]): string {
  const code = firstString(chain, "code");
  if (code !== undefined) return code;
  const status = firstStatus(chain);
  return status === undefined ? "unknown" : `http_${status}`;
}

/** A plain object's `message` (a PostgREST error response), else the value as text. */
export function messageOf(error: unknown): string {
  const message: unknown =
    typeof error === "object" && error !== null ? (error as { message?: unknown }).message : undefined;
  return typeof message === "string" ? message : String(error);
}

/**
 * Reports a system fault the caller handles (and so never rethrows to the middleware): one log line
 * and one Sentry event grouped by `step` and the error's code. The code is `options.code`, else the
 * first non-empty `code` along `error`'s `cause` chain, else `http_<status>`, else `unknown`. A `hint`
 * becomes a tag, email-masked and cut to 200 characters, since tags bypass `scrubEvent`. `details`,
 * request bodies and users are never read.
 */
export function reportHandledError(
  step: string,
  error: unknown,
  options: { level?: "error" | "warning"; code?: string } = {},
): void {
  const level = options.level ?? "error";
  const chain = causeChain(error);
  const code = options.code ?? errorCode(chain);
  const hint = firstString(chain, "hint");
  const message = error instanceof Error ? error.message : messageOf(error);
  const stack = error instanceof Error ? error.stack : undefined;

  const log = level === "warning" ? console.warn : console.error;
  // Auth messages can quote the email; `scrubEvent` masks the event, this masks the log line.
  log(`${step} failed: ${code} ${maskEmails(message)}`, stack === undefined ? undefined : maskEmails(stack));

  // Sentry serialises a non-Error input whole into `extra` (PostgREST `details` included), which
  // `scrubEvent` doesn't touch; a cause that isn't an Error is never sent.
  const reported = error instanceof Error ? error : new Error(`${step} failed: ${code} ${message}`, { cause: error });

  captureException(reported, {
    level,
    fingerprint: ["handled", step, code],
    tags: {
      step,
      error_code: code,
      ...(hint === undefined ? {} : { error_hint: maskEmails(hint).slice(0, HINT_MAX_LENGTH) }),
    },
  });
}
