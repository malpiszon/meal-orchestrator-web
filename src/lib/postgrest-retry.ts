/**
 * Waits before each retry of a PostgREST request rejected with PGRST303 "JWT issued at future":
 * 2 retries, at most 2 s added. PostgREST v14.5 (what hosted Supabase runs) can check a fresh
 * session's `iat` against a stale cached "now" (fixed upstream in v14.18, #5196); a moment later the
 * same token is accepted.
 */
export const PGRST303_RETRY_DELAYS_MS = [500, 1500] as const;

interface PostgrestErrorLike {
  code?: string;
  message: string;
}

/**
 * True only for PostgREST's stale-clock rejection. PGRST303 also covers other JWT claim failures,
 * which a retry can't fix, so the message must say "issued at future" too.
 */
export function isJwtIssuedAtFuture(error: PostgrestErrorLike): boolean {
  return error.code === "PGRST303" && error.message.toLowerCase().includes("issued at future");
}

/**
 * Runs the PostgREST request `run` builds and, while its result's error is PGRST303 "JWT issued at
 * future", waits (`PGRST303_RETRY_DELAYS_MS`) and runs a new one. Any other result is returned at
 * once; after the last retry, the last result is returned unchanged, so the caller's error handling
 * still applies. `run` must build a new request on every call: a PostgREST builder executes when
 * awaited, so the same builder can't be awaited twice. `label` names the call in the retry warning,
 * which carries no user data.
 */
export async function withPgrst303Retry<R extends { error: PostgrestErrorLike | null }>(
  label: string,
  run: () => PromiseLike<R>,
): Promise<R> {
  let result = await run();
  for (const [index, delayMs] of PGRST303_RETRY_DELAYS_MS.entries()) {
    if (!result.error || !isJwtIssuedAtFuture(result.error)) return result;
    console.warn(
      `${label}: PGRST303 JWT issued at future, retry ${index + 1}/${PGRST303_RETRY_DELAYS_MS.length} in ${delayMs} ms`,
    );
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    result = await run();
  }
  return result;
}
