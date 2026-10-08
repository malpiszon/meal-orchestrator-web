import type { APIRoute } from "astro";
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
  // Errors are logged but answered like a success: GoTrue only rate-limits (429) or fails to send
  // for existing accounts, so showing them would reveal which emails have one.
  if (error) {
    console.error(`auth forgot-password: resetPasswordForEmail failed: ${error.code ?? error.status} ${error.message}`);
  }

  return context.redirect(`${FORGOT_PASSWORD_PATH}?sent=1`);
};
