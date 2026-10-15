import type { APIRoute } from "astro";
import { classifyAuthError, RESET_EMAIL_QUIET_CODES } from "@/lib/auth-errors";
import { reportHandledError } from "@/lib/report-handled-error";
import { FORGOT_PASSWORD_PATH, resetRequestSchema } from "@/lib/set-password";
import { createStatelessClient } from "@/lib/supabase";
import type { ForgotPasswordErrorCode } from "@/lib/forgot-password-errors";

export const prerender = false;

/**
 * Asks Supabase to email a set-a-new-password link. Answers the same for known and unknown
 * emails, so the form never reveals which accounts exist.
 */
export const POST: APIRoute = async (context) => {
  const backWithError = (code: ForgotPasswordErrorCode) => context.redirect(`${FORGOT_PASSWORD_PATH}?error=${code}`);

  const form = await context.request.formData().catch(() => null);
  if (!form) {
    return backWithError("invalid_email");
  }
  const parsed = resetRequestSchema.safeParse({ email: form.get("email") ?? undefined });
  if (!parsed.success) {
    return backWithError("invalid_email");
  }

  // Cookie-less client: the reset is often finished in another browser, so no PKCE verifier cookie.
  const supabase = createStatelessClient();
  if (!supabase) {
    return backWithError("not_configured");
  }

  // No redirectTo: the recovery template builds the link from {{ .SiteURL }}.
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email);
  // Every error is answered like a success, so the page never reveals which emails have an account.
  // GoTrue answers 200 for an unknown email, so any error left is a rate limit, an address it
  // rejects as malformed (`RESET_EMAIL_QUIET_CODES`), or a system fault (such as an SMTP or provider
  // outage), which is reported.
  if (error) {
    switch (classifyAuthError(error, RESET_EMAIL_QUIET_CODES)) {
      case "fault":
        reportHandledError("auth.forgot_password", error);
        break;
      case "rate_limit":
        console.warn(`auth forgot-password: rate limited (${error.code ?? error.status})`);
        break;
      case "quiet":
        console.info(`auth forgot-password: rejected (${error.code})`);
    }
  }

  return context.redirect(`${FORGOT_PASSWORD_PATH}?sent=1`);
};
