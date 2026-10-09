/** The codes the auth routes put in `/auth/signin?error=…`. */
export type SignInErrorCode =
  "invalid_credentials" | "rate_limited" | "not_configured" | "sign_in_failed" | "invalid_link";

/** Fixed text per code. The page never shows text taken from the URL. */
export const SIGN_IN_ERROR_MESSAGES: Record<SignInErrorCode, string> = {
  invalid_credentials: "Wrong email or password.",
  rate_limited: "Too many sign-in attempts. Wait a minute and try again.",
  not_configured: "Sign-in isn't configured on this server.",
  sign_in_failed: "Couldn't sign you in. Try again in a moment.",
  invalid_link: "This link is invalid or has expired. Ask for a new one.",
};

/** The part of a GoTrue (`AuthError`) error used to pick a code. */
interface AuthErrorLike {
  code?: string | null;
}

/** The redirect code for a Supabase Auth sign-in error; the raw message is for the logs only. */
export function signInErrorCode(error: AuthErrorLike | null | undefined): SignInErrorCode {
  switch (error?.code) {
    case "invalid_credentials":
      return "invalid_credentials";
    case "over_request_rate_limit":
      return "rate_limited";
    default:
      return "sign_in_failed";
  }
}

/** The fixed message for a code from the URL; `null` for no code or an unknown one. */
export function signInErrorMessage(code: string | null): string | null {
  if (code === null || !Object.hasOwn(SIGN_IN_ERROR_MESSAGES, code)) return null;
  return SIGN_IN_ERROR_MESSAGES[code as SignInErrorCode];
}
