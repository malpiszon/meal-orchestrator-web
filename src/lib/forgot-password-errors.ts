/** The codes the auth routes put in `/auth/forgot-password?error=…`. */
export type ForgotPasswordErrorCode = "invalid_email" | "not_configured" | "invalid_link";

/** Fixed text per code. The page never shows text taken from the URL. */
export const FORGOT_PASSWORD_ERROR_MESSAGES: Record<ForgotPasswordErrorCode, string> = {
  invalid_email: "Enter a valid email address",
  not_configured: "Password reset isn't configured on this server.",
  invalid_link: "This link is invalid or has expired. Ask for a new one.",
};

/** The fixed message for a code from the URL; `null` for no code or an unknown one. */
export function forgotPasswordErrorMessage(code: string | null): string | null {
  if (code === null || !Object.hasOwn(FORGOT_PASSWORD_ERROR_MESSAGES, code)) return null;
  return FORGOT_PASSWORD_ERROR_MESSAGES[code as ForgotPasswordErrorCode];
}
