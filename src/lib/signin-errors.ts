import { isAuthError } from "@supabase/supabase-js";
import { classifyAuthError, SIGN_IN_QUIET_CODES } from "@/lib/auth-errors";

/** The codes the auth routes put in `/auth/signin?error=…`. */
export type SignInErrorCode =
  "invalid_credentials" | "rate_limited" | "not_configured" | "sign_in_failed" | "invalid_link" | "session_unavailable";

/** Fixed text per code. The page never shows text taken from the URL. */
export const SIGN_IN_ERROR_MESSAGES: Record<SignInErrorCode, string> = {
  invalid_credentials: "Wrong email or password.",
  rate_limited: "Too many sign-in attempts. Wait a minute and try again.",
  not_configured: "Sign-in isn't configured on this server.",
  sign_in_failed: "Couldn't sign you in. Try again in a moment.",
  invalid_link: "This link is invalid or has expired. Ask for a new one.",
  session_unavailable: "We couldn't check your sign-in. Try again in a moment.",
};

/** The redirect code for a Supabase Auth sign-in error; the raw message is for the logs only. */
export function signInErrorCode(error: unknown): SignInErrorCode {
  // The same rule the route's log line uses, so the page never blames the user for a reported fault.
  switch (classifyAuthError(error, SIGN_IN_QUIET_CODES)) {
    case "rate_limit":
      return "rate_limited";
    case "fault":
      return "sign_in_failed";
    case "quiet":
      return isAuthError(error) && error.code === "invalid_credentials" ? "invalid_credentials" : "sign_in_failed";
  }
}

/** The fixed message for a code from the URL; `null` for no code or an unknown one. */
export function signInErrorMessage(code: string | null): string | null {
  if (code === null || !Object.hasOwn(SIGN_IN_ERROR_MESSAGES, code)) return null;
  return SIGN_IN_ERROR_MESSAGES[code as SignInErrorCode];
}
