import type { SupabaseClient, User } from "@supabase/supabase-js";
import { type AuthErrorKind, classifyAuthError, SESSION_QUIET_CODES } from "@/lib/auth-errors";
import { reportHandledError } from "@/lib/report-handled-error";

/**
 * Quiet codes that a real cookie session rarely produces (auth-js refreshes before expiry and always
 * sends the bearer): many of them at once point to a JWT key or secret mismatch or a proxy dropping
 * `Authorization`, so they get a warn line, still no report.
 */
const SUSPICIOUS_SESSION_CODES: ReadonlySet<string> = new Set(["bad_jwt", "no_authorization"]);

/** Why the session couldn't be checked: an Auth system fault (reported) or a rate limit (a warn line). */
export type SessionCheckFailure = Exclude<AuthErrorKind, "quiet">;

/**
 * The signed-in user, or `null`. Every failure reads as signed out; `failure` is set when the session
 * couldn't be checked at all, rather than being missing, expired or revoked (`null`). Only a `fault`
 * is reported, under `step`.
 */
export async function readSessionUser(
  supabase: SupabaseClient,
  step: string,
): Promise<{ user: User | null; failure: SessionCheckFailure | null }> {
  let result: Awaited<ReturnType<SupabaseClient["auth"]["getUser"]>>;
  try {
    result = await supabase.auth.getUser();
  } catch (error) {
    reportHandledError(step, error);
    return { user: null, failure: "fault" };
  }

  const { error } = result;
  if (!error) return { user: result.data.user, failure: null };

  switch (classifyAuthError(error, SESSION_QUIET_CODES)) {
    case "fault":
      reportHandledError(step, error);
      return { user: null, failure: "fault" };
    case "rate_limit":
      console.warn(`auth session: rate limited (${error.code ?? error.status})`);
      return { user: null, failure: "rate_limit" };
    case "quiet":
      if (error.code && SUSPICIOUS_SESSION_CODES.has(error.code)) {
        console.warn(`auth session: signed out by ${error.code}`);
      }
      return { user: null, failure: null };
  }
}
