import { isAuthError, isAuthRetryableFetchError, isAuthSessionMissingError } from "@supabase/supabase-js";

/** `getUser()` codes that mean "signed out" (an expired, revoked or refused session), not an outage. */
export const SESSION_QUIET_CODES: ReadonlySet<string> = new Set([
  "refresh_token_not_found",
  "refresh_token_already_used",
  "session_expired",
  "session_not_found",
  "bad_jwt",
  "user_not_found",
  "user_banned",
  "no_authorization",
]);

/** `verifyOtp` codes for a dead link: GoTrue answers `otp_expired` for an expired, used or made-up token. */
export const VERIFY_OTP_QUIET_CODES: ReadonlySet<string> = new Set(["otp_expired"]);

/** `signInWithPassword` codes that are the user's own (a wrong password, an unusable account). */
export const SIGN_IN_QUIET_CODES: ReadonlySet<string> = new Set([
  "invalid_credentials",
  "email_not_confirmed",
  "user_banned",
]);

/** `resetPasswordForEmail` answers 200 for an unknown email, so no code is normal there. */
export const RESET_EMAIL_QUIET_CODES: ReadonlySet<string> = new Set();

/** Whether an Auth error is a rate limit: status 429, or a code such as `over_request_rate_limit`. */
export function isAuthRateLimit(error: unknown): boolean {
  if (!isAuthError(error)) return false;
  return error.status === 429 || (error.code?.endsWith("_rate_limit") ?? false);
}

/**
 * Whether an Auth call's error is a system fault to report, rather than a normal outcome for the
 * call site (a code in `quietCodes`, a missing session or a rate limit). A fault is a non-`AuthError`,
 * a network failure or 5xx (`AuthRetryableFetchError`, status 0 or ≥ 500), an error with no code,
 * or a code the site doesn't expect.
 */
export function isAuthSystemFault(error: unknown, quietCodes: ReadonlySet<string>): boolean {
  if (!isAuthError(error)) return true;
  if (isAuthRetryableFetchError(error)) return true;
  if (error.status === undefined || error.status === 0 || error.status >= 500) return true;
  if (isAuthRateLimit(error)) return false;
  if (!error.code) return !isAuthSessionMissingError(error);
  return !quietCodes.has(error.code);
}
