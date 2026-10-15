import type { SupabaseClient, User } from "@supabase/supabase-js";
import { classifyAuthError, SESSION_QUIET_CODES } from "@/lib/auth-errors";
import { reportHandledError } from "@/lib/report-handled-error";

/**
 * Quiet codes that a real cookie session rarely produces (auth-js refreshes before expiry and always
 * sends the bearer): many of them at once point to a JWT key or secret mismatch or a proxy dropping
 * `Authorization`, so they get a warn line, still no report.
 */
const SUSPICIOUS_SESSION_CODES: ReadonlySet<string> = new Set(["bad_jwt", "no_authorization"]);

/**
 * The signed-in user, or `null`. Every failure reads as signed out; `fault` is true when that was an
 * Auth system fault (reported under `step`) rather than a missing, expired or revoked session, and
 * `rateLimited` when Auth refused the check with a rate limit (a warn line only).
 */
export async function readSessionUser(
  supabase: SupabaseClient,
  step: string,
): Promise<{ user: User | null; fault: boolean; rateLimited: boolean }> {
  let result: Awaited<ReturnType<SupabaseClient["auth"]["getUser"]>>;
  try {
    result = await supabase.auth.getUser();
  } catch (error) {
    reportHandledError(step, error);
    return { user: null, fault: true, rateLimited: false };
  }

  const { error } = result;
  if (!error) return { user: result.data.user, fault: false, rateLimited: false };

  switch (classifyAuthError(error, SESSION_QUIET_CODES)) {
    case "fault":
      reportHandledError(step, error);
      return { user: null, fault: true, rateLimited: false };
    case "rate_limit":
      console.warn(`auth session: rate limited (${error.code ?? error.status})`);
      return { user: null, fault: false, rateLimited: true };
    case "quiet":
      if (error.code && SUSPICIOUS_SESSION_CODES.has(error.code)) {
        console.warn(`auth session: signed out by ${error.code}`);
      }
      return { user: null, fault: false, rateLimited: false };
  }
}
